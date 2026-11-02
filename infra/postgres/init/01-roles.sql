-- Papéis e bancos de DESENVOLVIMENTO. Em produção, crie os papéis com senhas fortes
-- (ver docs/DEPLOYMENT.md). Este arquivo é idempotente.
--
-- barber_owner : dono do schema. Executa migrações e rotinas de plataforma.
--                Por ser dono das tabelas, NÃO é afetado por RLS (sem FORCE).
-- barber_app   : papel usado pela API em tempo de execução. NOSUPERUSER, NOBYPASSRLS,
--                portanto sempre sujeito às políticas de Row-Level Security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barber_owner') THEN
    CREATE ROLE barber_owner LOGIN PASSWORD 'barber_owner_dev' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barber_app') THEN
    CREATE ROLE barber_app LOGIN PASSWORD 'barber_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

SELECT 'CREATE DATABASE barber_voice OWNER barber_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'barber_voice')\gexec

SELECT 'CREATE DATABASE barber_voice_test OWNER barber_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'barber_voice_test')\gexec
