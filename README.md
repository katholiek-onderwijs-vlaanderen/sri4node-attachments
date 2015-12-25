# sri4node-attachments
Support module to easily add support for attachments (BLOBs) on SRI resources implemented with [sri4node](https://github.com/dimitrydhondt/sri4node).  
Currently supports storing attachments in a local folder, or on Amazon S3. 

## Example

    // First configure the module
    //
    var winston = require('winston');
    var sri4nodeAttachments = require('sri4node-attachements');
    var attachements = sri4nodeAttachments.configure(winston, {
      s3key: process.env.S3_KEY,
      s3secret: process.env.S3_SECRET,
      s3bucket: process.env.S3_BUCKET
    });
    //
    // In you sri4node resource configuration
    //
    ...
    customroutes: [
        attachments.customRouteForDownload('/people'),  // support GETting
        attachments.customRouteForUpload('/people')     // support PUTting
    ]
    ...
  
Next you can use `PUT` on `/people/{guid}/filename.jpg` to create and update attachments. 
Any filename can be used. The attachement is associated with `/people/{guid}`
And you can do `GET` on the same URL to retrieve your attachment.  
  
It supports these configuration options : 

* `s3key` : Use this key to connect to S3.
* `s3secret` : Use this secret to connect to S3.
* `s3bucket` : Store the attachments in this S3 bucket.
* `s3region` : Connect to this S3 region. Default `eu-west-1`.

* `folder` : If you want to store the attachements in a local folder specify an existing folder here.

* `tempFolder` : Must be a writable directory. Used for intermediate storage of uploaded attachments.
* `maximumFilesizeInMB` : The maximum size for file uploads, in megabytes.

## Adding middleware
You can add custom middleware (one or an array of them) in the routes that are handling your attachments :

    ...
    customroutes: [
        attachments.customRouteForUpload('/people', myMiddleware),
        attachments.customRouteForDownload('/people', [ myMiddleware1, myMiddleware2 ])
    ]
    ...
    
## Future

Next :

* Add a flexible way to support meta information on the attachemnts. 
* Provide an sri4node `afterread` function to allow adding $$atachments listing available attachments. 
* Provide an sri4node `afterdelete`function to make it easy to delete attachments when a resource is removed.
* In the future storage for smaller items in postgres may be added.
* ...

