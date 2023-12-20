const assert = require("assert");
const uuid = require("uuid");
const { debug } = require("../js/common.js");
const { SriError } = require("sri4node");

const { uploadFilesAndCheck, copyFilesAndCheck } = require("./common.js");

/**
 * This JavaScript function, checkStoreAttachment, validates the structure and properties of the
 * file object.
 * It checks if the file object has three properties: file, attachment, and resource.
 * Each of these properties should be an object and have certain expected properties.
 *  * file.file should be an object and have the properties: mimetype, filename, tmpFileName, size, and hash.
 *  * file.attachment should be an object and have the properties: key, description, and aCustomTestProperty.
 *  * file.resource should be an object and have the properties: href and key.
 * If any of these conditions are not met, the function throws an error (SriError) with a status
 * of 500 and a detailed error message. The error message includes the specific property that is
 * missing or the specific object that is not an object.
 *
 * @param {*} file 
 */
const checkStoreAttachment = (file) => {
  if (file.file && typeof file.file !== 'object') {
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
    if (file.file && file.file[prop] === undefined) {
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
 * This factory will create a handler function that can be passed to sri4node attachments
 * runAfterUpload handler.
 *
 * You can decide with the flags whether you want to handle multiple uploads together or
 * upload in sequence. In case of multiple uploads together, the handler function will
 * receive an array of files. In case of upload in sequence, the handler function will
 * receive a single file.
 * If handleMultipleUploadsTogether=false and uploadInSequence=true, a thrird parameter
 * is required, which is a reference to an array that is used to store the attachments.
 * This can be used somewhere else inu the tests to verify the order of the uploads.
 *
 * @param {boolean} handleMultipleUploadsTogether 
 * @param {boolean} uploadInSequence 
 * @param {Array<string>} checkStoreAttachmentsReceivedList a reference to an array that is used to store the attachments, which will be used to verify the order of the uploads (in a few cases)
 * @returns
 */
function checkStoreAttachmentFactory(handleMultipleUploadsTogether, uploadInSequence, checkStoreAttachmentsReceivedList = undefined) {
  if (handleMultipleUploadsTogether) {
    return (files) => files.forEach(file => checkStoreAttachment(file));
  }
  if (uploadInSequence) {
    if (!Array.isArray(checkStoreAttachmentsReceivedList)) {
      throw new Error("checkStoreAttachmentsReceivedList must be an array, if uploadInSequence is true");
    }
    return (file) => {
      if (file.fileObj) {
        checkStoreAttachmentsReceivedList.push(file.fileObj.filename.substring(0,8));
      }
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
  } else {
    assert.fail("[verifyCheckStoreAttachmentsReceivedListOrder] checkStoreAttachmentsReceivedList is empty, which is unexpected. Checking the order of uploads is only useful when handleMultipleUploadsTogether = false and upladoInSequence = true (cfr. checkStoreAttachmentFactory).");
  }
}


exports = module.exports = {
  checkStoreAttachmentFactory,
  /**
   * 
   * @param {*} httpClient 
   * @param {*} type 
   * @param {*} checkStoreAttachmentsReceivedList a reference to the same array that is also passed in the checkStoreAttachmentFactory as a parameter, which will be used to verify the order of the uploads (in a few cases)
   */
  factory: function (httpClient, type, checkStoreAttachmentsReceivedList = null) {
    // const checkStoreAttachmentsReceivedList = [];
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

            if (checkStoreAttachmentsReceivedList) clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut);
            if (checkStoreAttachmentsReceivedList) verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

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

            if (checkStoreAttachmentsReceivedList) clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut2);
            if (checkStoreAttachmentsReceivedList) verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

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

            if (checkStoreAttachmentsReceivedList) clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await uploadFilesAndCheck(httpClient, filesToPut);
            if (checkStoreAttachmentsReceivedList) verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);

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
            
            if (checkStoreAttachmentsReceivedList) clearCheckStoreAttachmentsReceivedList(checkStoreAttachmentsReceivedList);
            await copyFilesAndCheck(httpClient, filesToPut2);
            if (checkStoreAttachmentsReceivedList) verifyCheckStoreAttachmentsReceivedListOrder(checkStoreAttachmentsReceivedList);
          } catch (err) {
            console.log(err);
            assert.fail([err.err]);
          }
        });
      });

    });
  }
};
