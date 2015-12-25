# sri4node-attachments
Support module to easily add support for attachments (BLOBs) on [SRI](https://github.com/dimitrydhondt/sri) 
resources implemented with [sri4node](https://github.com/dimitrydhondt/sri4node).  
Currently supports storing attachments in a local folder, or on Amazon S3. 

## Example

    // First configure the module
    //
    var winston = require('winston'); // For logging.
    var sri4nodeAttachments = require('sri4node-attachements');
    var attachments = sri4nodeAttachments.configure(winston, {
      s3key: process.env.S3_KEY,
      s3secret: process.env.S3_SECRET,
      s3bucket: process.env.S3_BUCKET
    });
    //
    // In your sri4node resource configuration
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

## Configuration
* `s3key` : Use this key to connect to S3.
* `s3secret` : Use this secret to connect to S3.
* `s3bucket` : Store the attachments in this S3 bucket.
* `s3region` : Connect to this S3 region. Default `eu-west-1`.
* `folder` : If you want to store the attachements in a local folder specify an *existing* folder here.
* `tempFolder` : Must be a writable directory. Used for intermediate storage of uploaded attachments.
* `maximumFilesizeInMB` : The maximum size for file uploads, in megabytes.

### Adding custom middleware
You can add custom middleware (one or an array of them) in the routes that are handling your attachments :

    ...
    customroutes: [
        attachments.customRouteForUpload('/people', myMiddleware),
        attachments.customRouteForDownload('/people', [ myMiddleware1, myMiddleware2 ])
    ]
    ...
    
You can use this to update for example a database table, or a JSONB column on the affected resource, etc..

## Future
* Add a flexible way to support meta information on the attachments. 
* Provide an sri4node `afterread` function to allow adding $$atachments listing available attachments. 
* Provide an sri4node `afterdelete`function to make it easy to delete attachments when a resource is removed.
* In the future storage for smaller items in postgres may be added.
* ...

