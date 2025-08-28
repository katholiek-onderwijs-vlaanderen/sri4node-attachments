# Changelog

## v2.3.3 - 28 August 2025

### Fixed

- Attachments plugin streaming race condition when connection is terminated before the download has started, leaving the connection/request open for ever.

## v2.3.2 - 3 May 2024

### Fixed

- File upload: allow special characters in the filename (see busboy config defParamCharset)

## version 2.3.1 (20-12-2023)
New features: 
* allow file-less attachments
* optional new parameter for customRouteForDownload: checkDownload, a function that is called to allow the client to check and abort the download, like in cases where it belongs to a deleted node
  
## version 2.3.0 (14-09-2023)
Adapted to sri4node 2.3 + big refactor + dockerized testsuite using localstack.
