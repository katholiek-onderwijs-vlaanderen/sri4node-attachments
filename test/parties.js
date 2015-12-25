var Q = require('q');
var sri4nodeAttachments = require('../sri4node-attachments.js');

exports = module.exports = function (sri4node, winston) {
  'use strict';
  var $u = sri4node.utils,
    $m = sri4node.mapUtils,
    $s = sri4node.schemaUtils,
    $q = sri4node.queryUtils;
/*
  function debug(x) {
    winston.log('debug', x);
  }
*/
  var attachments = sri4nodeAttachments.configure(winston, {
    s3key: process.env.S3_KEY, // eslint-disable-line
    s3secret: process.env.S3_SECRET, // eslint-disable-line
    s3bucket: process.env.S3_BUCKET, // eslint-disable-line
    folder: '/tmp/inner-gerbil'
  });

  var ret = {
    // Base url, maps 1:1 with a table in postgres
    // Same name, except the '/' is removed
    type: '/parties',
    // Is this resource public ?
    // Can it be read / updated / inserted publicly ?
    public: false,
    // Multiple function that check access control
    // They receive a database object and
    // the security context of the current user.
    secure: [
      //checkAccessOnResource,
      //checkSomeMoreRules
    ],
    // Standard JSON Schema definition.
    // It uses utility functions, for compactness.
    schema: {
      $schema: 'http://json-schema.org/schema#',
      title: 'A person, organisations, subgroup, group, connector group, etc... ' +
        'participating in a mutual credit system, time bank or knowledge bank.',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'The type of party this resource describes.',
          enum: ['person', 'organisation', 'subgroup', 'group', 'connector']
        },
        name: $s.string(
          'The name of the party. If it is a person with a christian name you should store ' +
          '[firstname initials/middlename lastname]. As there is no real universal format for naming people, ' +
          'we do not impose one here. (Like making 2 fields, firstname and lastname would do)'
        ),
        alias: $s.string('Handle the party wants to be known by.'),
        dateofbirth: $s.timestamp('Date of birth for people. Other types of parties don\'t have a date of birth.'),
        imageurl: $s.string('URL to a profile image for people, a logo for groups, etc...'),
        login: $s.string('Login for accessing the API. Only people have a login.', 3),
        password: $s.string(
          'Password for accessing the API. Only people have a password. ' +
          'Can only be PUT, and is never returned on GET.',
          3),
        secondsperunit: $s.numeric(
          'If the party is a group that operates a time bank (i.e. agreements with ' +
          'the members exist about using time as currency), then this value expresses the number units per second.'
        ),
        currencyname: $s.string('The name of the currency, as used by a mutual credit group'),
        status: {
          type: 'string',
          description: 'The status of this party.',
          enum: ['active', 'inactive']
        }
      },
      required: ['type', 'name', 'status']
    },
    // Functions that validate the incoming resource
    // when a PUT operation is executed.
    validate: [
      //validateAuthorVersusThemes
    ],
    // Supported URL parameters are configured
    // this allows filtering on the list resource.
    query: {
      defaultFilter: $q.defaultFilter
    },
    queryDocs: {
    },
    // All columns in the table that appear in the
    // resource should be declared.
    // Optionally mapping functions can be given.
    map: {
      key: {},
      type: {},
      name: {},
      alias: {
        onread: $m.removeifnull
      },
      dateofbirth: {
        onread: $m.removeifnull
      },
      imageurl: {
        onread: $m.removeifnull
      },
      login: {
        onread: $m.removeifnull
      },
      password: {
        onread: $m.remove
      },
      secondsperunit: {
        onread: $m.removeifnull
      },
      currencyname: {
        onread: $m.removeifnull
      },
      status: {}
    },
    // After update, insert or delete
    // you can perform extra actions.
    afterread: [
    ],
    afterupdate: [],
    afterinsert: [],
    afterdelete: [],
    customroutes: [
      attachments.customRouteForUpload('/parties'),
      attachments.customRouteForDownload('/parties')
    ]
  };

  return ret;
};
