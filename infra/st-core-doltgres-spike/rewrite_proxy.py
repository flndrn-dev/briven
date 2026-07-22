#!/usr/bin/env python3
"""Phase-0 SuperTokens→Doltgres SQL rewrite proxy (spike only, not production)."""
import asyncio, re, struct, sys
LISTEN_PORT = int(sys.argv[1]) if len(sys.argv)>1 else 15432
UPSTREAM_HOST = sys.argv[2] if len(sys.argv)>2 else "doltgres"
UPSTREAM_PORT = int(sys.argv[3]) if len(sys.argv)>3 else 5432
stats = {"rewrites": 0, "queries": 0}

def rewrite_sql(sql: str) -> str:
    orig = sql
    sql = re.sub(
        r"SET\s+SESSION\s+CHARACTERISTICS\s+AS\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+READ\s+COMMITTED\s*;?",
        "SET default_transaction_isolation TO 'read committed'", sql, flags=re.I)
    sql = re.sub(r"CONSTRAINT\s+[A-Za-z0-9_]+(\s+UNIQUE\b)", r"\1", sql, flags=re.I)
    sql = re.sub(r"CONSTRAINT\s+[A-Za-z0-9_]+(\s+CHECK\b)", r"\1", sql, flags=re.I)
    sql = re.sub(r"\s+PARTITION\s+BY\s+RANGE\s*\([^)]*\)", "", sql, flags=re.I)
    sql = re.sub(r"\s+PARTITION\s+BY\s+LIST\s*\([^)]*\)", "", sql, flags=re.I)
    sql = re.sub(r"\s+PARTITION\s+BY\s+HASH\s*\([^)]*\)", "", sql, flags=re.I)
    if re.search(r"\bPARTITION\s+OF\b", sql, re.I):
        sql = "SELECT 1"
    sql = re.sub(r"\s+USING\s+brin\b", "", sql, flags=re.I)
    sql = re.sub(r"\bDROP\s+(TABLE|INDEX|VIEW)\s+(.+?)\s+CASCADE\b", r"DROP \1 \2", sql, flags=re.I)
    if sql != orig:
        stats["rewrites"] += 1
    return sql

def process_client_buffer(buf: bytearray):
    out = bytearray(); i = 0
    while True:
        if len(buf) - i < 5: break
        mtype = buf[i]
        if mtype == 0:
            if len(buf)-i < 4: break
            (length,) = struct.unpack_from("!I", buf, i)
            if length < 4 or length > 10_000_000:
                out.extend(buf[i:]); return out, bytearray()
            if len(buf)-i < length: break
            out.extend(buf[i:i+length]); i += length; continue
        (length,) = struct.unpack_from("!I", buf, i+1)
        total = 1 + length
        if length < 4 or total > 10_000_000:
            out.extend(buf[i:]); return out, bytearray()
        if len(buf)-i < total: break
        msg = bytes(buf[i:i+total])
        if mtype == ord('Q'):
            payload = msg[5:]
            if payload.endswith(b'\x00'):
                sql = payload[:-1].decode('utf-8','replace')
                stats['queries'] += 1
                new_sql = rewrite_sql(sql)
                if new_sql != sql:
                    new_payload = new_sql.encode() + b'\x00'
                    msg = bytes([ord('Q')]) + struct.pack('!I', 4+len(new_payload)) + new_payload
        elif mtype == ord('P'):
            body = msg[5:]
            try:
                z1 = body.index(b'\x00'); name = body[:z1+1]; rest = body[z1+1:]
                z2 = rest.index(b'\x00'); query = rest[:z2].decode('utf-8','replace'); tail = rest[z2:]
                stats['queries'] += 1
                new_q = rewrite_sql(query)
                if new_q != query:
                    new_body = name + new_q.encode() + tail
                    msg = bytes([ord('P')]) + struct.pack('!I', 4+len(new_body)) + new_body
            except ValueError: pass
        out.extend(msg); i += total
    return out, bytearray(buf[i:])

async def pipe_c2s(reader, writer):
    buf = bytearray()
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk: break
            buf.extend(chunk)
            to_send, buf = process_client_buffer(buf)
            if to_send:
                writer.write(to_send); await writer.drain()
    except Exception: pass
    finally:
        if buf:
            try: writer.write(buf); await writer.drain()
            except: pass
        try: writer.close(); await writer.wait_closed()
        except: pass

async def pipe_s2c(reader, writer):
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk: break
            writer.write(chunk); await writer.drain()
    except Exception: pass
    finally:
        try: writer.close(); await writer.wait_closed()
        except: pass

async def handle(cr, cw):
    try:
        ur, uw = await asyncio.open_connection(UPSTREAM_HOST, UPSTREAM_PORT)
    except Exception as e:
        print(f"[err] {e}", flush=True); cw.close(); return
    t1=asyncio.create_task(pipe_c2s(cr,uw)); t2=asyncio.create_task(pipe_s2c(ur,cw))
    await asyncio.wait([t1,t2], return_when=asyncio.FIRST_COMPLETED)
    t1.cancel(); t2.cancel()

async def main():
    s = await asyncio.start_server(handle, '0.0.0.0', LISTEN_PORT)
    print(f"[listen] :{LISTEN_PORT} -> {UPSTREAM_HOST}:{UPSTREAM_PORT}", flush=True)
    async with s: await s.serve_forever()
asyncio.run(main())
