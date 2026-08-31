const region = { innerWidth: 32, innerHeight: 32, paddingX: 4, paddingY: 4 };
const move = (x, y) => ({ kind: "move", x, y });
const line = (x, y) => ({ kind: "line", x, y });
const quadratic = (controlX, controlY, x, y) => ({
  kind: "quadratic",
  controlX,
  controlY,
  x,
  y,
});
const cubic = (control0X, control0Y, control1X, control1Y, x, y) => ({
  kind: "cubic",
  control0X,
  control0Y,
  control1X,
  control1Y,
  x,
  y,
});
const close = { kind: "close" };

function oracleCase(id, candidateSha256, bounds, commands) {
  return {
    id,
    candidateSha256,
    request: { unitsPerEm: 1_000, bounds, region, commands },
  };
}

export const mtsdfOracleCases = [
  oracleCase(
    "ordinary-square",
    "0a273899c2577afa03cfea282fe5ca2e7bc4610407f537e515965862e77aa5cd",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(100, 900), line(900, 900), line(900, 100), close],
  ),
  oracleCase(
    "acute-corner",
    "732dc274bb1667712186bb959c67bed6a79492854c5f4219057ae60664cee167",
    { minX: 100, minY: 100, maxX: 565, maxY: 950 },
    [move(100, 100), line(500, 950), line(565, 100), close],
  ),
  oracleCase(
    "overlapping-contours",
    "a507a3a901af8e0120b2e597ca9736df9672cd1b6d26719d22ac25d2a4cbcffa",
    { minX: 100, minY: 100, maxX: 900, maxY: 800 },
    [
      move(100, 200),
      line(100, 800),
      line(600, 800),
      line(600, 200),
      close,
      move(400, 100),
      line(400, 700),
      line(900, 700),
      line(900, 100),
      close,
    ],
  ),
  oracleCase(
    "self-intersection",
    "8e2f166b8f5a75b8bdb80b5c2154cb2012b10c55493a1749d91fb2c3c57df937",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [move(100, 100), line(900, 900), line(100, 900), line(900, 100), close],
  ),
  oracleCase(
    "quadratic-oval",
    "2d402af986b36b02c3907c659cdf484d6ca0859f3034b87089af79311fe45e9d",
    { minX: 100, minY: 100, maxX: 900, maxY: 900 },
    [
      move(100, 500),
      quadratic(100, 900, 500, 900),
      quadratic(900, 900, 900, 500),
      quadratic(900, 100, 500, 100),
      quadratic(100, 100, 100, 500),
      close,
    ],
  ),
  oracleCase(
    "cubic-teardrop",
    "738260fbea9fadf9ab4e891919513fa26207138c034f20a134644ca710fef4e5",
    { minX: 80, minY: 100, maxX: 920, maxY: 950 },
    [
      move(500, 950),
      cubic(920, 740, 900, 210, 500, 100),
      cubic(100, 210, 80, 740, 500, 950),
      close,
    ],
  ),
  oracleCase(
    "complex-counter",
    "48ad8161120e5f204a1cd47d6f5da927839529b66b2504613b6d26568076f8ee",
    { minX: 80, minY: 100, maxX: 920, maxY: 920 },
    [
      move(80, 100),
      line(380, 920),
      line(620, 920),
      line(920, 100),
      line(720, 100),
      line(650, 310),
      line(350, 310),
      line(280, 100),
      close,
      move(410, 480),
      line(590, 480),
      line(500, 760),
      close,
    ],
  ),
];
