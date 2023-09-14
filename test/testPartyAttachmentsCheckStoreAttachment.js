const assert = require("assert");
const uuid = require("uuid");
const { debug } = require("../js/common.js");
const { SriError } = require("sri4node");

const { uploadFilesAndCheck, copyFilesAndCheck } = require("./common.js");


const checkStoreAttachment = (file) => {
  if (file.file === null || typeof file.file !== 'object') {
    throw new SriError({
      status: 500,
      errors: [
        {
          code: "file.attachment.is.not.an.object",
          type: "ERROR",
          message: `expected file.file to be an object`,
        },
      ],
    });
  }
  const expectedFileProperties = [
    'mimetype',
    'filename',
    // 'originalFilename',
    'tmpFileName',
    'size',
    'hash',
  ];
  expectedFileProperties.forEach(prop => {
    if (file.file[prop] === undefined) {
      throw new SriError({
        status: 500,
        errors: [
          {
            code: "file.file.is.missing.expected.property",
            type: "ERROR",
            message: `expected file.file object is missing property ${prop}`,
          },
        ],
      });
    }
  });

  if (file.attachment === null || typeof file.attachment !== 'object') {
    throw new SriError({
      status: 500,
      errors: [
        {
          code: "file.attachment.is.not.an.object",
          type: "ERROR",
          message: `expected file.attachment to be an object`,
        },
      ],
    });
  }
  const expectedAttachmentProperties = [
    'key',
    'description',
    'aCustomTestProperty',
  ];
  expectedAttachmentProperties.forEach(prop => {
    if (file.attachment[prop] === undefined) {
      throw new SriError({
        status: 500,
        errors: [
          {
            code: "file.attachment.is.missing.expected.property",
            type: "ERROR",
            message: `expected file.attachment object is missing property ${prop}`,
          },
        ],
      });
    }
  });

  if (file.resource === null || typeof file.resource !== 'object') {
    throw new SriError({
      status: 500,
      errors: [
        {
          code: "file.resource.is.not.an.object",
          type: "ERROR",
          message: `expected resource.attachment to be an object`,
        },
      ],
    });
  }
  const expectedResourceProperties = [
    'href',
    'key',
  ];
  expectedResourceProperties.forEach(prop => {
    if (file.resource[prop] === undefined) {
      throw new SriError({
        status: 500,
        errors: [
          {
            code: "file.resource.is.missing.expected.property",
            type: "ERROR",
            message: `expected file.attachment object is missing property ${prop}`,
          },
        ],
      });
    }
  });
};


/**
 * 
 * @param {*} handleMultipleUploadsTogether 
 * @param {*} uploadInSequence 
 * @param {*} checkStoreAttachmentsReceivedList 
 * @returns 
 */
function checkStoreAttachmentsFactory(handleMultipleUploadsTogether, uploadInSequence, checkStoreAttachmentsReceivedList = undefined) {
  if (handleMultipleUploadsTogether) {
    return (files) => files.forEach(file => checkStoreAttachment(file));
  }
  if (uploadInSequence) {
    return (file) => {
      checkStoreAttachmentsReceivedList.push(file.fileObj.filename.substring(0,8));
      checkStoreAttachment(file);
    };
  }
  return checkStoreAttachment;
}

function clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList) {
  if (checkStoreAttachmentsReceivedList) {
    checkStoreAttachmentsReceivedList.length = 0; // clear the array
  }
}

function verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList) {
  if (checkStoreAttachmentsReceivedList && checkStoreAttachmentsReceivedList.length > 0) {
    const checkStoreAttachmentsReceivedListCopy = [...checkStoreAttachmentsReceivedList];
    checkStoreAttachmentsReceivedListCopy.sort();
    assert.deepStrictEqual(checkStoreAttachmentsReceivedList, checkStoreAttachmentsReceivedListCopy);
  }
}


exports = module.exports = {
  checkStoreAttachmentFactory: checkStoreAttachmentsFactory,
  factory: function (httpClient, type, checkStoreAttachmentsReceivedList) {
    describe(type, function () {
      describe("checkStoreAttachment", function () {
        it("UPLOAD and COPY via upload", async () => {
          try {
            const body = {
              type: "person",
              name: "test user",
              status: "active",
            };
            const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3, attachmentKey4] = Array.from({ length: 5 }, () => uuid.v4());
            const resourceHref = type + "/" + resourceKey;
            const attachmentDownloadUrl1 = type + "/" + resourceKey + "/attachments/profile1_*__.png";
            const attachmentDownloadUrl2 = type + "/" + resourceKey + "/attachments/profile2.png";
            const attachmentDownloadUrl3 = type + "/" + resourceKey + "/attachments/profile3.png";
            const attachmentDownloadUrl4 = type + "/" + resourceKey + "/attachments/profile4.png";
            const [attachmentKey1b, attachmentKey2b, attachmentKey3b, attachmentKey4b] = Array.from({ length: 4 }, () => uuid.v4());

            const response = await httpClient.put({ path: resourceHref, body });
            assert.equal(response.status, 201);

            debug("PUTting the profile images as attachments");
            const filesToPut = [
              {
                remotefileName: "profile1 *% .png",
                localFilename: "test/images/orange-boy-icon.png",
                attachmentKey: attachmentKey1,
                resourceHref,
              },
              {
                remotefileName: "profile2.png",
                localFilename: "test/images/little-boy-white.png",
                attachmentKey: attachmentKey2,
                resourceHref,
              },
              {
                remotefileName: "profile3.png",
                localFilename: "test/images/avatar-black.png",
                attachmentKey: attachmentKey3,
                resourceHref,
              },
              {
                remotefileName: "profile4.png",
                localFilename: "test/images/avatar-blue.png",
                attachmentKey: attachmentKey4,
                resourceHref,
              },
            ];

            clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut);
            verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

            // Multiple upload with attachments copies with new names
            const filesToPut2 = [
              {
                remotefileName: "profile1 *% b.png",
                urlToCopy: attachmentDownloadUrl1,
                attachmentKey: attachmentKey1b,
                resourceHref,
              },
              {
                remotefileName: "profile2b.png",
                urlToCopy: attachmentDownloadUrl2,
                attachmentKey: attachmentKey2b,
                resourceHref,
              },
              {
                remotefileName: "profile3b.png",
                urlToCopy: attachmentDownloadUrl3,
                attachmentKey: attachmentKey3b,
                resourceHref,
              },
              {
                remotefileName: "profile4b.png",
                urlToCopy: attachmentDownloadUrl4,
                attachmentKey: attachmentKey4b,
                resourceHref,
              },
            ];

            clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut2);
            verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

          } catch (err) {
            assert.fail([err.err]);
          }
        });

        it("UPLOAD and COPY via /copy", async () => {
          try {
            const body = {
              type: "person",
              name: "test user",
              status: "active",
            };
            const [resourceKey, attachmentKey1, attachmentKey2, attachmentKey3, attachmentKey4] = Array.from({ length: 5 }, () => uuid.v4());
            const resourceHref = type + "/" + resourceKey;
            const attachmentDownloadUrl1 = type + "/" + resourceKey + "/attachments/profile1_*__.png";
            const attachmentDownloadUrl2 = type + "/" + resourceKey + "/attachments/profile2.png";
            const attachmentDownloadUrl3 = type + "/" + resourceKey + "/attachments/profile3.png";
            const attachmentDownloadUrl4 = type + "/" + resourceKey + "/attachments/profile4.png";
            const [attachmentKey1b, attachmentKey2b, attachmentKey3b, attachmentKey4b] = Array.from({ length: 4 }, () => uuid.v4());

            const response = await httpClient.put({ path: resourceHref, body });
            assert.equal(response.status, 201);

            debug("PUTting the profile images as attachments");
            const filesToPut = [
              {
                remotefileName: "profile1 *% .png",
                localFilename: "test/images/orange-boy-icon.png",
                attachmentKey: attachmentKey1,
                resourceHref,
              },
              {
                remotefileName: "profile2.png",
                localFilename: "test/images/little-boy-white.png",
                attachmentKey: attachmentKey2,
                resourceHref,
              },
              {
                remotefileName: "profile3.png",
                localFilename: "test/images/avatar-black.png",
                attachmentKey: attachmentKey3,
                resourceHref,
              },
              {
                remotefileName: "profile4.png",
                localFilename: "test/images/avatar-blue.png",
                attachmentKey: attachmentKey4,
                resourceHref,
              },
            ];

            await uploadFilesAndCheck(httpClient, filesToPut);

            // Multiple upload with one extra attachment which is a copy of an existing attachment
            const filesToPut2 = [
              {
                remotefileName: "profile1 *% b.png",
                urlToCopy: attachmentDownloadUrl1,
                attachmentKey: attachmentKey1b,
                resourceHref,
              },
              {
                remotefileName: "profile2b.png",
                urlToCopy: attachmentDownloadUrl2,
                attachmentKey: attachmentKey2b,
                resourceHref,
              },
              {
                remotefileName: "profile3b.png",
                urlToCopy: attachmentDownloadUrl3,
                attachmentKey: attachmentKey3b,
                resourceHref,
              },
              {
                remotefileName: "profile4b.png",
                urlToCopy: attachmentDownloadUrl4,
                attachmentKey: attachmentKey4b,
                resourceHref,
              },
            ];
            
            clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await copyFilesAndCheck(httpClient, filesToPut2);
            verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);
          } catch (err) {
            console.log(err);
            assert.fail([err.err]);
          }
        });
      });

    });
  }
};
