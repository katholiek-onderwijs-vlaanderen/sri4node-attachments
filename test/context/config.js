/* Configuration for sri4node, used for our server.js, but also for mocha tests */
const sri4node = require("sri4node");
const {
  sri4nodeAttchmentUtilsFactory: sri4nodeAttachmentUtilsFactory,
} = require("../../js/sri4node-attachments.js");
const { error } = require("../../js/common.js");
const partiesFactory = require("./parties");

const knownIdentities = {};
const knownPasswords = {};

/**
 *
 * @param {boolean} verbose
 * @returns { Promise<import('sri4node').TSriConfig> }
 */
module.exports = async function (verbose) {
  const $u = sri4node.utils;

  const identity = async (username, database) => {
    const query = $u.prepareSQL("me");
    query.sql("select * from parties where login = ").param(username);
    try {
      const result = await $u.executeSQL(database, query);
      const row = result.rows[0];
      const ret = {
        permalink: `/parties/${row.key}`,
        login: row.login,
        name: row.name,
        alias: row.alias,
        dateofbirth: row.dateofbirth,
        imageurl: row.imageurl,
        messages: { href: `/messages?postedByParties=/parties/${row.key}` },
        transactions: {
          href: `/transactions?involvingParties=/parties/${row.key}`,
        },
        contactdetails: {
          href: `/contactdetails?forParties=/parties/${row.key}`,
        },
        parents: { href: `/parties?ancestorsOfParties=/parties/${row.key}` },
        partyrelations: { href: `/partyrelations?from=/parties/${row.key}` },
      };
      if (ret.imageurl === null) {
        delete ret.imageurl;
      }
      if (ret.alias === null) {
        delete ret.alias;
      }
      return ret;
    } catch (err) {
      error(`Error retrieving /me for login [${username}]`);
      error(err);
      error(err.stack);
      throw err;
    }
  };

  const attachmentUtilsForS3 = await sri4nodeAttachmentUtilsFactory(
    {
      s3key: "",
      s3secret: "",
      s3bucket: "tests3bucket",
      accessKeyId: "",
      s3region: "eu-west-1",
    },
    sri4node
  );

  return {
    databaseConnectionParameters: {
      host: "localhost",
      port: 15435,
      database: "postgres",
      user: "postgres",
      password: "postgres",
    },
    description: "",
    logdebug: {
      channels: [
        "sri4node-attachments",
        "trace",
        "general",
        "batch",
        "db",
        "sql",
      ],
    },
    resources: [
      partiesFactory(sri4node, verbose, attachmentUtilsForS3, "/partiesS3"),
      // Is storing files locally still supported?
      // partiesFactory(sri4node, verbose, attachmentUtilsForLocalFolder, '/partiesFolder'),
    ],
  };
};
