# sri4node-attachments
Support module to easily add support for attachments (BLOBs) on [SRI](https://github.com/dimitrydhondt/sri)
resources implemented with [sri4node](https://github.com/dimitrydhondt/sri4node).
Currently supports storing attachments on Amazon S3.
This is sri4node-attachments 2.0 for sri4node 2.0. it hooks into busboy's streaming handlers from sri4node

## Example

    // First configure the module
    //
    const sri4nodeAttachments = require('sri4node-attachments');
    const attachments = sri4nodeAttachments.configure({
      s3key: process.env.S3_KEY,
      s3secret: process.env.S3_SECRET,
      s3bucket: process.env.S3_BUCKET,
      s3region: 'eu-central-1',
      maxRetries: 3
    });
    //
    // Then pass the attachments plugin with your resource
    //
    resources: [
        require('./resources/activities.js')(attachments),
    ]
    //
    // In your sri4node resource configuration
    //
    ...
    customRoutes: [
      attachments.customRouteForUpload(uploadFile), //uploadFile is a function that will be called ONCE FOR EACH FILE that has been uploaded on s3.
      attachments.customRouteForDownload(),
      attachments.customRouteForDelete(deleteFile), //deleteFile is a function that will be called once the file is deleted on s3
    ]
    ...

Next you can use `PUT` on `/activities/{guid}/attachments/filename.jpg` to create and update attachments.
Any filename can be used. The attachement is associated with `/activities/{guid}`
And you can do `GET` on the same URL to retrieve your attachment.

## Configuration
* `s3key` : Use this key to connect to S3.
* `s3secret` : Use this secret to connect to S3.
* `s3bucket` : Store the attachments in this S3 bucket.
* `s3region` : Connect to this S3 region. Default `eu-west-1`.
* `maximumFilesizeInMB` : The maximum size for file uploads, in megabytes.

### Adding after handlers
You can add custom handlers in the routes that are handling your attachments :

    ...
    customroutes: [
      attachments.customRouteForUpload(uploadFile), //uploadFile is a function that will be called ONCE FOR EACH FILE that has been uploaded on s3.
      attachments.customRouteForDownload(),
      attachments.customRouteForDelete(deleteFile), //deleteFile is a function that will be called once the file is deleted on s3
    ]
    ...
    

You can use this to update for example a database table, or a JSONB column on the affected resource, etc..



### Storing the attachment reference in your database

    ///Example of uploadFile
    ...
    const uploadFile = async function (tx, sriRequest, file) {
      await createOrUpdateAttachment(tx, sriRequest.params.key, file.filename, false);
      console.log('updated DB');
    }
    ...
    ///Example of deleteFile
    ...
    const deleteFile = async function (tx, sriRequest) {
      await createOrUpdateAttachment(tx, sriRequest.params.key, sriRequest.params.filename, true);
      console.log('updated DB');
    }
    ...
    ///Example of createOrUpdateAttachment
    ...
    async function createOrUpdateAttachment(tx, key, filename, deleted) {
      let resource = await tx.oneOrNone('select * from "attachments" where resource = $1 and filename=$2', [key, filename]);
    
      if (resource) {
        //update existing
        await tx.any('update "attachments" set "$$meta.modified" = current_timestamp, "$$meta.deleted" = $3 where resource = $1 and filename=$2', [key, filename, deleted]);
      } else if (!deleted) {
        await tx.none('insert into "attachments" (key, resource, filename) values($1,$2,$3)', [uuid(), key, filename]);
      }
    }
    ...

    ///example of attachments table
    
    CREATE TABLE "attachments" (
        key uuid primary key,
        "filename" text not null,
    	"resource" uuid REFERENCES "activities" (key),
    
        "$$meta.deleted" boolean default false,
        "$$meta.modified" timestamp with time zone not null default current_timestamp,
        "$$meta.created" timestamp with time zone not null default current_timestamp
    );
    
    ///example of adding $$attachments to your resource
    ...
    afterRead: [addAttachments],
    ...
    
    ...
    async function addAttachments(tx, sriReq, elements) {
      for (let element of elements) {
        let attachments = await tx.any('select * from "attachments" where resource = $1 and "$$meta.deleted" = false', [element.stored.key]);
        element.stored.$$attachments = []
        attachments.forEach(atta => {
          element.stored.$$attachments.push({ href: element.stored.$$meta.permalink + "/attachments/" + atta.filename })
        })
      }
    }
    ...