REVOKE ALL PRIVILEGES ON SCHEMA sri4nodeattachments FROM sri4nodeattachments;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA sri4nodeattachments FROM sri4nodeattachments;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA sri4nodeattachments FROM sri4nodeattachments;
DROP USER sri4nodeattachments;

DROP SCHEMA IF EXISTS sri4nodeattachments CASCADE;
