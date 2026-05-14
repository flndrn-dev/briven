# host-firewall-v6.md — IPv6 outbound deny on the runtime host

## why this runbook exists

`CLAUDE.md §5.3` requires customer Deno isolates on briven to refuse
outbound traffic to private + link-local IPv6 ranges:

- `::1` (loopback)
- `fc00::/7` (unique-local — covers `fc**::` and `fd**::`)
- `fe80::/10` (link-local)

Deno 2.x's `--deny-net` flag accepts IPv4 CIDRs only. The runtime
isolate has a belt-and-braces shim that rejects literal v6 URL
hostnames in those ranges (`apps/runtime/src/isolate-runtime/loop.ts`,
duplicated as `isBlockedV6Literal` in `apps/runtime/src/network-filter.ts`
for test coverage). The shim catches `http://[fc00::1]/foo`, but a
customer who DNS-resolves a name pointing at a private v6 address would
still get through at the network layer.

This runbook closes that gap by setting the deny at the host firewall
on every machine that runs `apps/runtime`. Today that's `kvm4`; future
hosts get the same treatment.

The shim and the firewall are layered defenses, not alternatives —
**both must be live in production.**

---

## prerequisites

- root SSH on the runtime host (kvm4: `ssh root@187.124.209.17`).
- `ip6tables` or `nftables` installed. Ubuntu 24.04 (the kvm4 baseline)
  ships `nftables` and a legacy `ip6tables` wrapper that maps to nft —
  either spelling works.
- The runtime container's user UID. On the briven kvm4 compose stack
  Deno isolates run inside `briven-runtime-1` under UID `1000` (the
  default Deno image user). Verify with:

  ```
  docker exec briven-runtime-1 id
  ```

---

## apply (one-shot — first deploy)

The rules deny outbound from the runtime container's network namespace
to the four v6 ranges. We **scope by destination only** (not by source
UID inside the container) because Docker's bridge namespacing means
the kernel sees only the bridge-NATted traffic on the host side; the
inner UID isn't visible.

```sh
# 1. flush existing rules in the briven-v6-out chain (if any), or
#    create the chain fresh.
ip6tables -N briven-v6-out 2>/dev/null || ip6tables -F briven-v6-out

# 2. deny the four ranges; ICMPv6 stays open so neighbour discovery
#    works.
ip6tables -A briven-v6-out -d ::1/128       -j REJECT --reject-with icmp6-adm-prohibited
ip6tables -A briven-v6-out -d fc00::/7      -j REJECT --reject-with icmp6-adm-prohibited
ip6tables -A briven-v6-out -d fe80::/10     -j REJECT --reject-with icmp6-adm-prohibited

# 3. wire the chain into the FORWARD path (Docker traffic crosses
#    FORWARD on its way out). Idempotent insertion at position 1 — if
#    the rule already exists, drop the duplicate before re-inserting.
ip6tables -D FORWARD -j briven-v6-out 2>/dev/null || true
ip6tables -I FORWARD 1 -j briven-v6-out
```

### persist across reboots

`ip6tables` rules vanish on reboot unless flushed to disk:

```sh
apt-get install -y iptables-persistent
ip6tables-save > /etc/iptables/rules.v6
```

Verify the file ends with the briven chain after a deploy:

```sh
grep briven-v6-out /etc/iptables/rules.v6
```

---

## verify

From inside the runtime container, `curl -v http://[fc00::1]/` must
fail with **operation not permitted** (kernel reject), not "could not
resolve host" (DNS) or "connection refused" (port closed). Same for
`[::1]` and `[fe80::1]`:

```sh
docker exec briven-runtime-1 sh -c 'curl --max-time 3 -v http://[fc00::1]/ 2>&1 | tail -5'
# expect: "Failed to connect ... Operation not permitted"

docker exec briven-runtime-1 sh -c 'curl --max-time 3 -v http://[::1]:9000/ 2>&1 | tail -5'
# expect: same Operation not permitted

# control: public v6 (cloudflare) must still work
docker exec briven-runtime-1 sh -c 'curl --max-time 3 -sI https://[2606:4700::6810:84e5]/'
# expect: HTTP/2 200 or 301
```

If the control test fails (public v6 also blocked), check whether the
host has IPv6 connectivity at all (`ip -6 addr` on the host). Hostinger
kvm4 ships v6 by default; if v6 has been disabled at the provider
level, the firewall rules are still correct — they just no-op.

---

## monitoring

Add a counter check to the existing prometheus / loki setup so a sudden
spike in REJECT-out drops paging the operator:

```sh
ip6tables -L briven-v6-out -v -n -x
```

Plug that into `infra/observability/promtail/config.yaml` or scrape via
node_exporter's textfile collector — pick whichever the host already
runs.

---

## rollback

If the rules cause an incident (rare — they only deny traffic that
shouldn't have been leaving in the first place), remove the chain:

```sh
ip6tables -D FORWARD -j briven-v6-out
ip6tables -F briven-v6-out
ip6tables -X briven-v6-out
ip6tables-save > /etc/iptables/rules.v6
```

Then re-investigate before re-applying.

---

## related

- `apps/runtime/src/network-filter.ts` — `isBlockedV6Literal` (test
  surface) + `BLOCKED_CIDRS` (the v4 set Deno enforces directly).
- `apps/runtime/src/isolate-runtime/loop.ts` — inlined v6 fetch shim
  (keep in sync with `isBlockedV6Literal`).
- `CLAUDE.md §5.3` — the policy this runbook implements.

*Last updated: 2026-05-14.*
