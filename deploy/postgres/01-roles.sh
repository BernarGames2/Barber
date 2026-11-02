#!/bin/sh
# Executado UMA vez, na criação do volume do PostgreSQL de produção.
# Cria o papel dono do schema (migrações) e o papel da aplicação (sempre sujeito a RLS).
set -eu
: "${DB_OWNER_PASSWORD:?defina DB_OWNER_PASSWORD}"
: "${DB_APP_PASSWORD:?defina DB_APP_PASSWORD}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$DB_OWNER_PASSWORD" -v app_pw="$DB_APP_PASSWORD" <<'SQL'
CREATE ROLE barber_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE barber_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE barber_voice OWNER barber_owner;
SQL
