# sri4node-attachments
Support module to easily add storage of attachements (images,pdfs, etc.. think: BLOBs) to SRI resources implemented with [sri4node](https://github.com/dimitrydhondt/sri4node).  
Currently supports storing attachments in a local folder, or on Amazon S3. 
In the future storage for smaller items in postgres may be added.

## Example

    var winston = require('winston');
    var sri4nodeAttachments = require('sri4node-attachements');
    var attachements = sri4nodeAttachments.configure(winston, {
      s3key: process.env.S3_KEY,
      s3secret: process.env.S3_SECRET,
      s3bucket: process.env.S3_BUCKET
     });
  
It supports these configuration options : 

* `s3key` : Use this key to connect to S3.
* `s3secret` : Use this secret to connect to S3.
* `s3bucket` : Store the attachments in this S3 bucket.
* `s3region` : Connect to this S3 region. Default `eu-west-1`.

* `folder` : If you want to store the attachements in a local folder specify an existing folder here.

* `tempFolder` : Must be a writable directory. Used for intermediate storage of uploaded attachments.
* `maximumFilesizeInMB` : The maximum size for file uploads, in megabytes.