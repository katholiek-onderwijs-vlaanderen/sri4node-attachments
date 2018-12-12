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
      maxRetries: 3,
      createBucketIfNotExists: true //optional, if true, creates the bucket if it doesnt exist yet.
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

Next you can use `PUT` on `/activities/{guid}/attachments/` to create and update attachments.
Any filename can be used. The attachement is associated with `/activities/{guid}`
And you can do `GET` on `/activities/{guid}/attachments/filename.jpg` to retrieve your attachment.
Each attachment that you PUT will need a BODY JSON file/string, containing at least the filename (to link the json with the file that is being uploaded) and a key. 
It is also possible to upload 'Attachments' that do not have files, such as hyperlinks, plain text files, .... these 'attachments' will not be uploaded to s3, but will be calling the filehandler as well.

### Example curl
curl -X PUT -F "body=[{\"key\":\"80c148de-20be-4d46-87fb-5d487f7c046e\", \"file\":\"thumbsUp.png\", \"description\":\"this is MY file\"},{\"key\":\"99c148de-20be-4d46-87fb-5d487f7c046e\", \"file\":\"Screenshot.png\"},{\"key\":\"68ee79bc-0062-4e3c-b25d-5c249272202f\", \"url\":\"https://www.google.be/?gws_rd=ssl\"}]" -F "data=@thumbsUp.png" -F "data=@Screenshot.png" http://somedomain.com/activityplans/activities/0ca68464-469b-48eb-8dd4-13980d524ad0/attachments

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

### Security

This plugin works together with the sri4node-security-api plugin

    const attachments = sri4nodeAttachments.configure({
      s3key: process.env.S3_KEY,
      s3secret: process.env.S3_SECRET,
      s3bucket: process.env.S3_BUCKET,
      s3region: 'eu-central-1',
      security: {
        plugin: securityPlugin,
        abilityPrepend: ''
      }
    });
    
you have to send the securityplugin into the configuration. the securityplugin has to be at least #2.0.19 as it needs the `checkPermissionOnResourceList` function.

* `plugin`: the security plugin
* `abilityPrepend`: a string to prepend to the ability requested. upload will use ability `create`, download will use `read` and delete will use `delete`. if you want to have separate abilities for the attachments, like `attachment_create`,`attachment_read`,... set abilityPrepend to `attachment_`.
* `abilityAppend`: same as prepend, but append.

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
      await createOrUpdateAttachment(tx, sriRequest, { file: { filename: sriRequest.params.filename } }, true);
      console.log('updated DB');
    }
    ...
    ///Example of createOrUpdateAttachment
    ...
    async function createOrUpdateAttachment(tx, sriRequest, file, deleted) {
      let key = sriRequest.params.key;
      let filename = file.file ? file.file.filename : null;
      //name, url, contenttype, description
      let contentType = null;
      if (file.file)
        contentType = file.contentType ? file.contentType : file.file.mimetype;
    
      let resource = await tx.oneOrNone('select * from "attachments" where resource = $1 and key = $2', [key, file.key]);
    
      if (resource) {
        //update existing (including deleted flag)
        await tx.any('update "attachments" set "$$meta.modified" = current_timestamp, "$$meta.deleted" = $2, name=$3, url=$4, "contentType"=$5, description=$6 where key = $1', [resource.key, deleted, file.name, file.url, contentType, file.description]);
      } else if (!deleted) {
        //no resource yet.
    
        await tx.none('insert into "attachments" (key, resource, filename, name, url, "contentType", description) values($1,$2,$3,$4,$5,$6,$7)', [file.key, key, filename, file.name, file.url, contentType, file.description]);
      }
    }
    ...

    ///example of attachments table
    
    CREATE TABLE "attachments" (
        key uuid primary key,
        "filename" text,
    	"resource" uuid REFERENCES "activities" (key) DEFERRABLE INITIALLY IMMEDIATE,
    	"name" text,
    	"description" text,
    	"url" text,
    	"contentType" text,
    
        "$$meta.deleted" boolean default false,
        "$$meta.modified" timestamp with time zone not null default current_timestamp,
        "$$meta.created" timestamp with time zone not null default current_timestamp
    );
    
    ///example of adding $$attachments to your resource
    ...
    afterRead: [addAttachments],
    ...
    
    ...
    function makeAttJson(att, element) {
      let json = {};
      if (att.filename) {
        json.href = element.stored.$$meta.permalink + "/attachments/" + att.filename;
      } else {
        json.url = att.url;
      }
      json.key = att.key;
    
      json.contentType = att.contentType;
      json.description = att.description;
    
      return json;
    }
    
    async function addAttachments(tx, sriReq, elements) {
      for (let element of elements) {
        if (element.stored) {
          let attachments = await tx.any('select * from "attachments" where resource = $1 and "$$meta.deleted" = false', [element.stored.key]);
          element.stored.$$attachments = []
          attachments.forEach(atta => {
            element.stored.$$attachments.push(makeAttJson(atta, element))
          })
        }
      }
    }
    ...
    
### Things to note

* Filenames have to be unique per resource. This means `/resource/guid/attachments/file1.jpg` can only contain one file1.jpg. It is possible to overwrite the file by sending file1.jpg to `/resource/guid/attachments/` but it must be accompanied by the same key. If not, an error is thrown.
* the `file` object passed to the callback function that runs for every uploaded file, is the JSON object that was sent for that file. `file.file` (that originally contained the filename) will be overwritten and contain the actual file itself (including filename, data, ...). 
* the passed `file` will also contain a `mimetype`.
* `/resource/guid/attachments/` can be seen as a batch, as multiple attachments (BODY json array) and data files can be uploaded at once.
* the `routePostfix` for the download and delete are regexed to only fire on filenames. You are free to add extra routes like  `/:key/attachments/:attachmentkey` if you want to handle showing a json file on that route for an attachment. 
    
### TODO
* update the tests
