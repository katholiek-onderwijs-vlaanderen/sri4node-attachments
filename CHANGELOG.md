# Changelog

## v2.4.0 - 23 November 2026
- updated libraries and adapted code accordingly
- cleanup of temp S3 files in case of errors (also when one of several copies fails)
- a failing rename of uploaded/copied files is undone: already renamed new files are removed and overwritten files are restored (also when S3 reported an error for a copy that was executed anyway)
- writes and deletes of the same S3 files by concurrent requests are serialized (PostgreSQL advisory locks), so a rollback never deletes or overwrites the files of another request, and the unique filename check can not be bypassed by concurrent requests
- requires sri4node >= v2.3.50 and sri4node-security-api >= v2.3.13 (see README)
- a client abort during a download results in a 499 (debug logging only) instead of a 500 error, S3 read errors during a download are still reported as 500
- removed unused @aws-sdk/s3-presigned-post dependency
- removed obsolete and unused customRouteForPreSignedUpload function
- fixed ambiguous customRouteForDownload url pattern, side effect is that uuid-like names (36 hex/dash characters, any case, since Express routing is case-insensitive) are no longer downloadable by name
- a lot of new test cases

## v2.3.6 - 12 February 2026
Added optional new parameter for customRouteForDownload: getCacheHeaders, a function that is called to allow the client to set caching headers based on sriRequest.

## v2.3.5 - 13 Januari 2026
Use the newly exposed "check" of sri4node-security to be able to configure the new security plugin "useIsPartOfInsteadOfLocalCheck" option to get raw resources from security resolved with /ispartof (needed when local resolving is nog possible as in persons-api-sri4node)

## v2.3.4 - 15 October 2025
Allow connecting to s3 buckets without access keys (so use the IAM role)

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
