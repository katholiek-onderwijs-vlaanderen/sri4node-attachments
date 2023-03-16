/**
 *
 * @param {import("sri4node")} sri4node
 * @param {boolean} verbose
 * @param {*} attachments
 * @param {*} type
 * @returns {import("sri4node").TResourceDefinition}
 */
module.exports = function (sri4node, verbose, attachments, type) {
  // var $u = sri4node.utils;
  const $m = sri4node.mapUtils;
  const $s = sri4node.schemaUtils;
  const $q = sri4node.queryUtils;
  /*
  function debug(x) {
    if(verbose) {
      console.log(x); // eslint-disable-line
    }
  }
  */
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
      attachments.customRouteForUpload(type),
      attachments.customRouteForDownload(type),
      attachments.customRouteForDelete(type),
    ],
  };
};
