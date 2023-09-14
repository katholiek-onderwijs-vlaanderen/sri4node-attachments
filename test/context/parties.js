/**
 *
 * @param {import("sri4node")} sri4node
 * @param { import("../../js/sri4node-attachments").TSri4NodeAttachmentUtils} attachments
 * @param {string} type
 * @param {*} customStoreAttachment optional argument to provide a custom store function for the attachments
 * @returns {import("sri4node").TResourceDefinition}
 */
module.exports = function (sri4node, attachments, type, customStoreAttachment) {
  const $m = sri4node.mapUtils;
  const $s = sri4node.schemaUtils;
  const $q = sri4node.queryUtils;

  const resourceMap = {};

  /**
   * Store attachment data in a local object for testing
   * @param { import("../../js/sri4node-attachments").TMultiPartSingleBodyForAfterUploadHandler
   *          | Array<import("../../js/sri4node-attachments").TMultiPartSingleBodyForAfterUploadHandler>} file
   */
  function storeAttachment(file) {
    if (Array.isArray(file)) {
      file.forEach(f => storeAttachment(f));
    } else {
      const resourceKey = file.resource.href.split("/").pop();
      const attachmentKey = file.attachment.key;
      if (resourceMap[resourceKey] === undefined) {
        resourceMap[resourceKey] = {};
      }
      resourceMap[resourceKey][attachmentKey] = file;
    }
  }

  /**
   * Create attachment JSON for testing
   * @returns
   */
  function attachmentJson(attFile, resourceKey, attachmentKey) {
    const nowString = new Date().toISOString();
    return {
      $$meta: {
        created: nowString,
        modified: nowString,
        permalink: `${type}/${resourceKey}/attachments/${attachmentKey}`,
      },
      href: `${type}/${resourceKey}/attachments/${attachmentKey}`,
      key: attFile.attachment.key,
      name: attFile.file,
      description: attFile.attachment.description,
      contentType: attFile.fileObj.mimeType,
    };
  }

  return {
    // Base url, maps 1:1 with a table in postgres
    // Same name, except the '/' is removed
    type,
    metaType: "ATTACHMENTS_TEST_PARTY",
    table: "parties",
    // Standard JSON Schema definition.
    // It uses utility functions, for compactness.
    schema: {
      $schema: "http://json-schema.org/schema#",
      title:
        "A person, organisations, subgroup, group, connector group, etc... " +
        "participating in a mutual credit system, time bank or knowledge bank.",
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key/id of this resource.",
        },
        type: {
          type: "string",
          description: "The type of party this resource describes.",
          enum: ["person", "organisation", "subgroup", "group", "connector"],
        },
        name: $s.string(
          "The name of the party. If it is a person with a christian name you should store " +
            "[firstname initials/middlename lastname]. As there is no real universal format for naming people, " +
            "we do not impose one here. (Like making 2 fields, firstname and lastname would do)"
        ),
        alias: $s.string("Handle the party wants to be known by."),
        dateofbirth: $s.timestamp(
          "Date of birth for people. Other types of parties don't have a date of birth."
        ),
        imageurl: $s.string(
          "URL to a profile image for people, a logo for groups, etc..."
        ),
        login: $s.string(
          "Login for accessing the API. Only people have a login.",
          3
        ),
        password: $s.string(
          "Password for accessing the API. Only people have a password. " +
            "Can only be PUT, and is never returned on GET.",
          3
        ),
        secondsperunit: $s.numeric(
          "If the party is a group that operates a time bank (i.e. agreements with " +
            "the members exist about using time as currency), then this value expresses the number units per second."
        ),
        currencyname: $s.string(
          "The name of the currency, as used by a mutual credit group"
        ),
        status: {
          type: "string",
          description: "The status of this party.",
          enum: ["active", "inactive"],
        },
      },
      required: ["type", "name", "status"],
    },
    // Supported URL parameters are configured
    // this allows filtering on the list resource.
    query: {
      defaultFilter: $q.defaultFilter,
    },
    // All columns in the table that appear in the
    // resource should be declared.
    // Optionally mapping functions can be given.
    map: {
      key: {
        columnToField: [$m.removeifnull],
      },
      type: {
        columnToField: [$m.removeifnull],
      },
      name: {
        columnToField: [$m.removeifnull],
      },
      alias: {
        columnToField: [$m.removeifnull],
        onread: $m.removeifnull,
      },
      dateofbirth: {
        columnToField: [$m.removeifnull],
        onread: $m.removeifnull,
      },
      imageurl: {
        columnToField: [$m.removeifnull],
        onread: $m.removeifnull,
      },
      login: {
        columnToField: [$m.removeifnull],
        onread: $m.removeifnull,
      },
      password: {
        columnToField: [$m.removeifnull],
        onread: $m.remove,
      },
      secondsperunit: {
        columnToField: [$m.removeifnull],
        onread: $m.removeifnull,
      },
      currencyname: {
        columnToField: [$m.removeifnull],
        onread: $m.removeifnull,
      },
      status: {
        columnToField: [$m.removeifnull],
      },
    },
    customRoutes: [
      attachments.customRouteForUpload(
        async function (_tx, _sriRequest, file) {
          if (customStoreAttachment) {
            customStoreAttachment(file);
          }
          storeAttachment(file);
        },
      ),
      attachments.customRouteForUploadCopy(
        async function (_tx, _sriRequest, file) {
          if (customStoreAttachment) {
            customStoreAttachment(file);
          }
          storeAttachment(file);
        },
      ),
      attachments.customRouteForDownload(),
      attachments.customRouteForDelete(
        async (_tx, _sriRequest, resourceKey, attachmentKey) =>
          resourceMap[resourceKey][attachmentKey].fileObj.filename,
        async (_tx, _sriRequest, resourceKey, attachmentKey) => {
          delete resourceMap[resourceKey][attachmentKey];
        }
      ),
      attachments.customRouteForGet(async function (
        _tx,
        sriRequest,
        resourceKey,
        attachmentKey
      ) {
        const attFile = resourceMap[resourceKey][attachmentKey];
        if (attFile !== undefined) {
          return attachmentJson(attFile, resourceKey, attachmentKey);
        } else {
          throw new sriRequest.SriError({
            status: 404,
            errors: [],
          });
        }
      }),
    ],
    afterRead: [
      (_tx, _sriRequest, data) => {
        data.forEach(({ permalink, stored }) => {
          const resourceKey = permalink.split("/").pop();
          console.log(permalink);
          stored.attachments = Object.entries(resourceMap[resourceKey]).map(
            ([attachmentKey, attFile]) => {
              return attachmentJson(attFile, resourceKey, attachmentKey);
            }
          );
        });
      },
    ],
  };
};
