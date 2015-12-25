CREATE USER sri4nodeattachments WITH PASSWORD 'sri4nodeattachments';
GRANT ALL PRIVILEGES ON SCHEMA sri4nodeattachments TO sri4nodeattachments;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA sri4nodeattachments TO sri4nodeattachments;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA sri4nodeattachments TO sri4nodeattachments;
ALTER USER sri4nodeattachments SET search_path = sri4nodeattachments;
