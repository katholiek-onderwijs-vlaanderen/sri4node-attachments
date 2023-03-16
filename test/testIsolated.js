const assert = require("assert");
const sriclient = require("sri4node-client");

const doGet = sriclient.get;
const doPut = sriclient.put;
const doDelete = sriclient.delete;
const needle = require("needle");
const uuid = require("uuid");
const common = require("../js/common");

const { debug } = common;

function doPutFile(url, filename, user, pwd) {
  const options = {
    multipart: true,
  };
  if (user && pwd) {
    options.username = user;
    options.password = pwd;
  }

  const data = {
    foo: "bar",
    image: { file: filename, content_type: "image/png" },
  };

  return needle.put(url, data, options);
}

/**
 * Creates some put and delete tests to the given baseurl (like http://localhost/myapi)
 * and type ('/documents')
 *
 * @param {string} base
 * @param {string} type
 */
module.exports = function (base, type) {
  describe(type, () => {
    describe("PUT", () => {
      it("should allow adding of profile picture as attachment.", async () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const id = uuid.v4();

        debug(`Generated UUID=${id}`);
        return doPut(`${base + type}/${id}`, body, "annadv", "test")
          .then((response) => {
            assert.equal(response.statusCode, 201);
            debug("PUTting the profile image as attachment.");
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              `${base + type}/${id}/profile.png`,
              file,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 201);
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            debug("Retrieving of file done");
            debug(`status code : ${response.statusCode}`);
            debug(`body length : ${response.body.length}`);
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length < 10000) {
              assert.fail(
                "Response too small, it should be the 10.x Kb image we sent..."
              );
            }
            const file = "test/little-boy-white.png";
            return doPutFile(
              `${base + type}/${id}/profile.png`,
              file,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            if (
              !response.body.length ||
              response.body.length < 6000 ||
              response.body > 9000
            ) {
              assert.fail("Replaced image should be about 7Kb...");
            }
            // Next : try to delete the resource.
            return doDelete(
              `${base + type}/${id}/profile.png`,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            // Now check that is is gone..
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            assert.equal(response.statusCode, 404);
          });
      });

      it("should be idempotent.", () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const id = uuid.v4();
        let size;

        debug(`Generated UUID=${id}`);
        return doPut(`${base + type}/${id}`, body, "annadv", "test")
          .then((response) => {
            assert.equal(response.statusCode, 201);
            debug("PUTting the profile image as attachment.");
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              `${base + type}/${id}/profile.png`,
              file,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 201);
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length < 10000) {
              assert.fail(
                "Response too small, it should be the 10.x Kb image we sent..."
              );
            }
            size = response.body.length;
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              `${base + type}/${id}/profile.png`,
              file,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length !== size) {
              assert.fail("Size should be constant.");
            }
          });
      });
    });

    describe("DELETE", () => {
      it("should be idempotent.", () => {
        const body = {
          type: "person",
          name: "test user",
          status: "active",
        };
        const id = uuid.v4();

        debug(`Generated UUID=${id}`);
        return doPut(`${base + type}/${id}`, body, "annadv", "test")
          .then((response) => {
            assert.equal(response.statusCode, 201);
            debug("PUTting the profile image as attachment.");
            const file = "test/orange-boy-icon.png";
            return doPutFile(
              `${base + type}/${id}/profile.png`,
              file,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 201);
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            debug("Retrieving of file done");
            debug(`status code : ${response.statusCode}`);
            debug(`body length : ${response.body.length}`);
            assert.equal(response.statusCode, 200);
            if (!response.body.length || response.body.length < 10000) {
              assert.fail(
                "Response too small, it should be the 10.x Kb image we sent..."
              );
            }
            return doDelete(
              `${base + type}/${id}/profile.png`,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            // Delete again.
            return doDelete(
              `${base + type}/${id}/profile.png`,
              "annadv",
              "test"
            );
          })
          .then((response) => {
            assert.equal(response.statusCode, 200);
            // Now check that is is gone..
            return doGet(`${base + type}/${id}/profile.png`, "annadv", "test");
          })
          .then((response) => {
            assert.equal(response.statusCode, 404);
          });
      });
    });
  });
};
// TODO : Define resource with S3 and file storage to test both
// TODO : When BLOB database storage is implemented, also add a resource on that with tests
// TODO : Implement + check after & before function (with database access) on GET, PUT and DELETE.
