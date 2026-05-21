\set pguser `echo "$POSTGRES_USER"`

CREATE DATABASE _briven WITH OWNER :pguser;
