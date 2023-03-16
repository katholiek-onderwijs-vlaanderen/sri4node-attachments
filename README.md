# sri4node-attachments

Support module to easily add support for attachments (BLOBs) on [SRI](https://github.com/dimitrydhondt/sri)
resources implemented with [sri4node](https://github.com/dimitrydhondt/sri4node).
Currently supports storing attachments on Amazon S3.
This is sri4node-attachments 2.0 for sri4node 2.0. it hooks into busboy's streaming handlers from sri4node

## Example

The examples below are assumed from am `/activities` API

    // First configure the module
    //
    const sri4nodeAttachments = require('sri4node-attachments');
    const attachments = sri4nodeAttachments.configure({
      s3key: process.env.S3_KEY,
      s3secret: process.env.S3_SECRET,
      s3bucket: process.env.S3_BUCKET,
      s3region: 'eu-central-1',
      maxRetries: 3,
      createBucketIfNotExists: true, //optional, if true, creates the bucket if it doesnt exist yet.
      checkFileExistence: true // optional, checks if the file already exists in s3
    });
    //
    // Then pass the attachments plugin with your resource
    //
    resources: [
        require('./resources/activities.js')(attachments),
    ]

    //
    //Signatures of the callback/handler functions
    //
    const uploadFile = async function (tx, sriRequest, file) {
      ...
    }

    const getFileName = async function (tx, sriRequest, resourceKey, attachmentKey) {
      let resource = .....

      return resource.filename;
    }

    const deleteFile = async function (tx, sriRequest, resourceKey, attachmentKey) {
    ...
    }

    const getAttJson = async function (tx, sriRequest, resourceKey, attachmentKey) {
    ....
      return json;
    }

    //
    // In your sri4node resource configuration
    //
    ...
    customRoutes: [
      attachments.customRouteForUpload(uploadFile),  //uploadFile is a function that will be called ONCE FOR EACH FILE that has been uploaded on s3.
      attachments.customRouteForDownload(),
      attachments.customRouteForDelete(getFileName, deleteFile),  //getFileName is a function that is called to retreive the filename from the database. deleteFile is a function that will be called once the file is deleted on s3
      attachments.customRouteForGet(getAttJson) //getAttJson is a function that gets the JSON of an attachment resource.
    ]
    ...

Next you can use `POST` on `/activities/attachments/` to create and update attachments.
Any filename can be used. The attachement is associated with `/activities/{guid}`
And you can do `GET` on `/activities/{guid}/attachments/filename.jpg` to retrieve/download your attachment.
Each attachment that you POST will need a BODY JSON file/string, containing at least the filename (to link the json with the file that is being uploaded) and a key.
It is also possible to upload 'Attachments' that do not have files, such as hyperlinks, plain text files, .... these 'attachments' will not be uploaded to s3, but will be calling the filehandler as well.
The /attachments POST handler should be seen as a batch operation with a transaction. If anything fails, everything will be undone.

It is possible to upload multiple files. It is also possible to upload one single file to multiple resources at once.

### Example JSON

    [
      {
        "file": "thumbsUp.1.png",
        "attachment": {
          "key": "19f50272-8438-4662-9386-5fc789420262",
          "description": "this is MY file"
        },
        "resource": {
          "href": "/activityplans/activities/43a651b0-e4a6-4fed-8102-a6f67d82a78b"
        }
      },
      {
        "file": "thumbsUp.2.png",
        "attachment": {
          "key": "11b9160c-ef51-4536-b97d-8e88bacf7568"
        },
        "resource": {
          "href": "/activityplans/activities/43a651b0-e4a6-4fed-8102-a6f67d82a78b"
        }
      },
      {
        "resource": {
          "href": "/activityplans/activities/43a651b0-e4a6-4fed-8102-a6f67d82a78b"
        },
        "attachment": {
          "key": "14f54569-645a-4916-894a-23187ecc179c",
          "href": "https://www.google.be/?gws_rd=ssl"
        }
      },
      {
        "file": "thumbsUp.1.png",
        "attachment": {
          "key": "449418b6-aa9a-4205-be52-b57636f8f042",
          "description": "this is MY file"
        },
        "resource": {
          "href": "/activityplans/activities/2740a9d9-fe4a-413e-b5c8-46b8327ed61f"
        }
      },
      {
        "file": "thumbsUp.2.png",
        "attachment": {
          "key": "79bce533-03bf-4a8c-b492-f84bf755ee84"
        },
        "resource": {
          "href": "/activityplans/activities/2740a9d9-fe4a-413e-b5c8-46b8327ed61f"
        }
      },
      {
        "resource": {
          "href": "/activityplans/activities/2740a9d9-fe4a-413e-b5c8-46b8327ed61f"
        },
        "attachment": {
          "key": "807333b2-97ec-4260-a9ad-c1615b30d923",
          "href": "https://www.google.be/?gws_rd=ssl"
        }
      }
    ]

### Example curl

curl -X POST -F "body=[{\"file\":\"thumbsUp.1.png\",\"attachment\":{\"key\":\"19f50272-8438-4662-9386-5fc789420262\",\"description\":\"this is MY file\"},\"resource\":{\"href\":\"/activityplans/activities/43a651b0-e4a6-4fed-8102-a6f67d82a78b\"}},{\"file\":\"thumbsUp.2.png\",\"attachment\":{\"key\":\"11b9160c-ef51-4536-b97d-8e88bacf7568\"},\"resource\":{\"href\":\"/activityplans/activities/43a651b0-e4a6-4fed-8102-a6f67d82a78b\"}},{\"resource\":{\"href\":\"/activityplans/activities/43a651b0-e4a6-4fed-8102-a6f67d82a78b\"},\"attachment\":{\"key\":\"14f54569-645a-4916-894a-23187ecc179c\",\"href\":\"https://www.google.be/?gws_rd=ssl\"}},{\"file\":\"thumbsUp.1.png\",\"attachment\":{\"key\":\"449418b6-aa9a-4205-be52-b57636f8f042\",\"description\":\"this is MY file\"},\"resource\":{\"href\":\"/activityplans/activities/2740a9d9-fe4a-413e-b5c8-46b8327ed61f\"}},{\"file\":\"thumbsUp.2.png\",\"attachment\":{\"key\":\"79bce533-03bf-4a8c-b492-f84bf755ee84\"},\"resource\":{\"href\":\"/activityplans/activities/2740a9d9-fe4a-413e-b5c8-46b8327ed61f\"}},{\"resource\":{\"href\":\"/activityplans/activities/2740a9d9-fe4a-413e-b5c8-46b8327ed61f\"},\"attachment\":{\"key\":\"807333b2-97ec-4260-a9ad-c1615b30d923\",\"href\":\"https://www.google.be/?gws_rd=ssl\"}}]" -F "data=@thumbsUp.1.png" -F "data=@thumbsUp.2.png" http://yourserver.com/activities/attachments

## Configuration

- `s3key` : Use this key to connect to S3.
- `s3secret` : Use this secret to connect to S3.
- `s3bucket` : Store the attachments in this S3 bucket.
- `s3region` : Connect to this S3 region. Default `eu-west-1`.
- `maximumFilesizeInMB` : The maximum size for file uploads, in megabytes.

### Adding after handlers

You can add custom handlers in the routes that are handling your attachments :

    ...
    customroutes: [
      attachments.customRouteForUpload(uploadFile),  //uploadFile is a function that will be called ONCE FOR EACH FILE that has been uploaded on s3.
      attachments.customRouteForDownload(),
      attachments.customRouteForDelete(getFileName, deleteFile),  //getFileName is a function that is called to retreive the filename from the database. deleteFile is a function that will be called once the file is deleted on s3
      attachments.customRouteForGet(getAttJson) //getAttJson is a function that gets the JSON of an attachment resource.
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
        abilityPrepend: '',
        abilityAppend: ''
      }
    });

you have to send the securityplugin into the configuration. the securityplugin has to be at least #2.0.19 as it needs the `checkPermissionOnResourceList` function.

- `plugin`: the security plugin
- `abilityPrepend`: a string to prepend to the ability requested. upload will use ability `create`, download will use `read` and delete will use `delete`. if you want to have separate abilities for the attachments, like `attachment_create`,`attachment_read`,... set abilityPrepend to `attachment_`.
- `abilityAppend`: same as prepend, but append.

### Storing the attachment reference in your database

    const uploadFile = async function (tx, sriRequest, file) {
      await createOrUpdateAttachment(tx, sriRequest, file, false);
    }

    const deleteFile = async function (tx, sriRequest, resourceKey, attachmentKey) {
      await createOrUpdateAttachment(tx, sriRequest, { resource: { key: resourceKey }, attachment: { key: attachmentKey } }, true);
    }

    const getFileName = async function (tx, sriRequest, resourceKey, attachmentKey) {
      let resource = await tx.one('select * from "attachments" where resource = $1 and key = $2', [resourceKey, attachmentKey]);

      return resource.filename;
    }

    const getAttJson = async function (tx, sriRequest, resourceKey, attachmentKey) {
      let att = await tx.one('select * from "attachments" where resource = $1 and key = $2', [resourceKey, attachmentKey]);

      return makeAttJson(att, path + '/' + resourceKey);
    }

    ///Example of createOrUpdateAttachment
    ...
    async function createOrUpdateAttachment(tx, sriRequest, file, deleted) {
      let key = file.resource.key;
      let filename = file.file ? file.file.filename : null;
      //name, url, contenttype, description
      let contentType = null;
      if (file.file)
        contentType = file.contentType ? file.contentType : file.file.mimetype;

      let activity = await tx.oneOrNone('select key from activities where key=$1', [key]); //validates the parent exists NO.

      if (!activity) {
        throw new sriRequest.SriError({
          status: 409,
          errors: [{
            code: 'attachment.parent.missing',
            type: 'ERROR',
            message: 'The parent resource with key ' + key + ' does not exist.'
          }]
        })
      }

      let resource = await tx.oneOrNone('select * from "attachments" where resource = $1 and key = $2', [key, file.attachment.key]);

      if (resource) {
        if (resource.filename !== filename && !deleted) {
          throw new sriRequest.SriError({
            status: 409,
            errors: [{
              code: 'filename.mismatch',
              type: 'ERROR',
              message: 'The existing attachment (' + resource.filename + ') can only be replaced with a file with the same name. (not:' + filename + ' )'
            }]
          })
        }

        //update existing (including deleted flag)
        await tx.any('update "attachments" set "$$meta.modified" = current_timestamp, "$$meta.deleted" = $2, name=$3, url=$4, "contentType"=$5, description=$6 where key = $1', [resource.key, deleted, file.attachment.name, file.attachment.href, contentType, file.attachment.description]);
      } else if (!deleted) {
        //no resource yet.

        await tx.none('insert into "attachments" (key, resource, filename, name, url, "contentType", description) values($1,$2,$3,$4,$5,$6,$7)', [file.attachment.key, key, filename, file.attachment.name, file.attachment.href, contentType, file.attachment.description]);
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
        json.href = att.url;
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

- Filenames have to be unique per resource. This means `/resource/guid/attachments/file1.jpg` can only contain one file1.jpg. It is possible to overwrite the file by sending file1.jpg to `/resource/guid/attachments/` but it must be accompanied by the same key. If not, an error is thrown.
- the `file` object passed to the callback function that runs for every uploaded file, is the JSON object that was sent for that file. `file.file` (that originally contained the filename) will be overwritten and contain the actual file itself (including filename, data, ...).
- the passed `file` will also contain a `mimetype`.
- `/resource/guid/attachments/` can be seen as a batch, as multiple attachments (BODY json array) and data files can be uploaded at once.
- the `routePostfix` for the download and delete are regexed to only fire on filenames. You are free to add extra routes like `/:key/attachments/:attachmentkey` if you want to handle showing a json file on that route for an attachment.
- you can throw errors in your afterUpload function. This will rollback all filechanges in the batch.

### TODO

- update the tests
