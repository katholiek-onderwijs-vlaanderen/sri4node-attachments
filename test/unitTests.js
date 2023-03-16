/* eslint-disable strict */
/* eslint-disable indent */
const assert = require("assert");
const rewire = require("rewire");

const sri4nodeAttachments = rewire("../js/sri4node-attachments.js");
const getSafeFilename = sri4nodeAttachments.__get__("getSafeFilename");

// AWS S3 guidelines: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html
describe("getSafeFilename", () => {
  const testCases = [
    {
      description: "Should allow all safe characters",
      filename: "blab-25_THING!.*'().png",
      expected: "blab-25_THING!.*'().png",
    },
    {
      description:
        "Should replace characters that require special handling with underscores.",
      filename: "blub+blob?&$@=;/:+ ,?56.jpg",
      expected: "blub_blob____________56.jpg",
    },
    {
      description: "Should replace characters to avoid with underscores.",
      filename: 'i\\{^%}`]["call><~#|.bs',
      expected: "i_________call_____.bs",
    },
    {
      description: "Should decode any encoded characters.",
      filename: "bl%2Fub%23%2A.pdf",
      expected: "bl_ub_*.pdf",
    },
  ];

  testCases.forEach((c) => {
    it(c.description, () => {
      assert.equal(getSafeFilename(c.filename), c.expected);
    });
  });
});
