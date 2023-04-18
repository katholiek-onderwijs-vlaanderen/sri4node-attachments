const assert = require("assert");

const needle = require("needle");
const uuid = require("uuid");
const { debug } = require("../js/common.js");
const fs = require("fs");

/**
 *
 * @param {import('needle').NeedleHttpVerbs} method
 * @param {string} url
 * @param {any} body will be JSON.stringified first !!!
 * @param {string} username
 * @param {string} password
 * @returns
 */
const doHttp = (method, url, body, username, password) =>
  needle(method, url, body, {
    json: true,
    username,
    password,
    // headers: {
    //   Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
    //     "base64"
    //   )}`,
    // },
  });

const doGet = (url, username, password) =>
  doHttp("get", url, "", username, password);
const doDelete = (url, username, password) =>
  doHttp("delete", url, "", username, password);
const doPut = (url, body, username, password) =>
  doHttp("put", url, body, username, password);

/**
 * This will use the /resource/attachments endpoint to upload one or multiple files.
 * This is a multipart post, where the 'body' part is a stringified and properly escaped
 * (escaping is handled by needle) JSON array of objects, each object having the following
 * properties:
 * ```javascript
 * {
 *    file: 'remotefileName', // string
 *    attachment: {
 *      key: attachmentKey, // guid
 *      description: `this is MY file`, // string
 *    },
 *    resource: {
 *      href: resourceHref, // href to the resource to which this attachment is attached
 *    },
 * }
 * ```
 * The 'data' part is a file, which is the local file to be uploaded.
 *
 * @param {string} resourceUrl is the url of the resource for which you want to put an attachment
 * @param {string} remotefileName
 * @param {string} localFilename
 * @param {string} attachmentKey (a guid)
 * @param {string} resourceHref the href of the resource for which you are uploading an attachment
 * @param {string} username
 * @param {string} password
 * @returns {Promise<any>} a needle http response
 */
async function doPutFile(
  resourceUrl,
  remotefileName,
  localFilename,
  attachmentKey,
  resourceHref,
  username,
  password
) {
  const options = {
    multipart: true,
    username,
    password,
  };

  // body=[{\"file\":\"thumbsUp.1.png\",\"attachment\":{\"key\":\"19f50272-8438-4662-9386-5fc789420262\",\"description\":\"this is MY file\"}
  const data = {
    body: JSON.stringify([
      {
        file: remotefileName,
        attachment: {
          key: attachmentKey,
          description: `this is MY file with key ${attachmentKey}`,
        },
        resource: {
          href: resourceHref,
        },
      },
    ]),
    data: {
      // file: localFilename,
      buffer: fs.readFileSync(localFilename),
      content_type: "image/png",
      filename: remotefileName,
    },
  };

  /*
    I think this translates to something like this (but how do multiple files work?):
      POST /upload HTTP/1.1
      Content-Type: multipart/form-data; boundary=------------------------a2b9b4e9d8c7b6a5

      --------------------------a2b9b4e9d8c7b6a5
      Content-Disposition: form-data; body="[{\"file\":\"thumbsUp.1.png\",\"attachment\":{\"key\":\"19f50272-8438-4662-9386-5fc789420262\",\"description\":\"this is MY file\"},\"resource\":{\"href\":\"/party/19f50272-8438-4662-9386-5fc789420262\"}}]"

      --------------------------a2b9b4e9d8c7b6a5
      Content-Disposition: form-data; name="data"; filename="thumbsUp.1.png"
      Content-Type: image/png

      <binary data>
      --------------------------a2b9b4e9d8c7b6a5--
  */

  return needle("post", resourceUrl + "/attachments", data, options);
}

exports = module.exports = function (base, type) {
  describe(type, function () {
    describe("PUT", function () {
      it("should allow adding of profile picture as attachment.", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey = uuid.v4();

        debug("Generated UUID=" + resourceKey);
        const response = await doPut(
          base + resourceHref,
          body,
          "annadv",
          "test"
        );
        assert.equal(response.statusCode, 201);

        debug("PUTting the profile image as attachment.");
        const file = "test/orange-boy-icon.png";
        const response2 = await doPutFile(
          base + type,
          "profile.png",
          file,
          attachmentKey,
          resourceHref,
          "annadv",
          "test"
        );
        assert.equal(response2.statusCode, 200);

        const response3 = await doGet(
          base + type + "/" + resourceKey + "/attachments/profile.png",
          "annadv",
          "test"
        );
        debug("Retrieving of file done");
        debug("status code : " + response3.statusCode);
        debug("body length : " + response3.body.length);
        assert.equal(response3.statusCode, 200);
        if (!response3.body.length || response3.body.length < 10000) {
          assert.fail(
            "Response too small, it should be the 10.x Kb image we sent..."
          );
        }
        const file2 = "test/little-boy-white.png";
        const response4 = await doPutFile(
          base + type,
          "profile.png",
          file2,
          attachmentKey,
          resourceHref,
          "annadv",
          "test"
        );
        assert.equal(response4.statusCode, 200);
        const response5 = await doGet(
          base + type + "/" + resourceKey + "/attachments/profile.png",
          "annadv",
          "test"
        );
        assert.equal(response5.statusCode, 200);
        if (
          !response5.body.length ||
          response5.body.length < 6000 ||
          response5.body > 9000
        ) {
          assert.fail("Replaced image should be about 7Kb...");
        }
        // Next : try to delete the resource.
        const response6 = await doDelete(
          base + type + "/" + resourceKey + "/attachments/profile.png",
          "annadv",
          "test"
        );
        assert.equal(response6.statusCode, 204);
        // Now check that is is gone..
        const response7 = await doGet(
          base + type + "/" + resourceKey + "/attachments/profile.png",
          "annadv",
          "test"
        );
        assert.equal(response7.statusCode, 404);
      });

      it("should be idempotent.", function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey = uuid.v4();
        let size;

        debug("Generated UUID=" + resourceKey);
        return doPut(base + resourceHref, body, "annadv", "test")
          .then(function (response) {
            assert.equal(response.statusCode, 201);
            debug("PUTting the profile image as attachment.");
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              base + type,
              "profile.png",
              file,
              attachmentKey,
              resourceHref,
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 200);
            return doGet(
              base + type + "/" + resourceKey + "/attachments/profile.png",
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length < 10000) {
              assert.fail(
                "Response too small, it should be the 10.x Kb image we sent..."
              );
            }
            size = response.body.length;
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              base + type,
              "profile.png",
              file,
              attachmentKey,
              resourceHref,
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 200);
            return doGet(
              base + type + "/" + resourceKey + "/attachments/profile.png",
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length !== size) {
              assert.fail("Size should be constant.");
            }
          });
      });
    });

    describe("DELETE", function () {
      it("should be idempotent (and actually delete the file).", function () {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const resourceKey = uuid.v4();
        const resourceHref = type + "/" + resourceKey;
        const attachmentKey = uuid.v4();

        debug("Generated UUID=" + resourceKey);
        return doPut(base + resourceHref, body, "annadv", "test")
          .then(function (response) {
            assert.equal(response.statusCode, 201);
            debug("PUTting the profile image as attachment.");
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              base + type,
              "profile.png",
              file,
              attachmentKey,
              resourceHref,
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 200);
            return doGet(
              base + type + "/" + resourceKey + "/attachments/profile.png",
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            debug("Retrieving of file done");
            debug("status code : " + response.statusCode);
            debug("body length : " + response.body.length);
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length < 10000) {
              assert.fail(
                "Response too small, it should be the 10.x Kb image we sent..."
              );
            }
            return doDelete(
              base + type + "/" + resourceKey + "/attachments/profile.png",
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 204);
            // Delete again.
            return doDelete(
              base + type + "/" + resourceKey + "/attachments/profile.png",
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 204);
            // Now check that is is gone..
            return doGet(
              base + type + "/" + resourceKey + "/attachments/profile.png",
              "annadv",
              "test"
            );
          })
          .then(function (response) {
            assert.equal(response.statusCode, 404);
          });
      });
    });

    // TODO, check if all customRoutes work as expected.
    // customRouteForUpload, customRouteForUploadCopy, customRouteForPreSignedUpload,
    // customRouteForDownload, customRouteForDelete, customRouteForGet
    describe("customRouteForUpload", function () {
      // TDOO
    });

    describe("customRouteForUploadCopy", function () {
      // TDOO
    });
  });
};
// TODO : Define resource with S3 and file storage to test both
// TODO : When BLOB database storage is implemented, also add a resource on that with tests
// TODO : Implement + check after & before function (with database access) on GET, PUT and DELETE.
