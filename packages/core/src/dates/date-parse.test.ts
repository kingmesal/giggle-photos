import { describe, expect, test } from "bun:test";
import { parseFilenameDate, parseFolderDate, wallTime } from "./date-parse";

const f = (name: string) => {
  const g = parseFilenameDate(name);
  return g ? [wallTime(g), g.precision] : null;
};
const d = (path: string) => {
  const g = parseFolderDate(path);
  return g ? [wallTime(g), g.precision, g.matched] : null;
};

describe("parseFilenameDate", () => {
  test("camera and phone names with a time", () => {
    expect(f("IMG_20190512_143000.jpg")).toEqual(["2019-05-12T14:30:00", "second"]);
    expect(f("PXL_20230105_081522123.jpg")).toEqual(["2023-01-05T08:15:22", "second"]);
    expect(f("VID_20190512_143000.mp4")).toEqual(["2019-05-12T14:30:00", "second"]);
    expect(f("Screenshot_2019-05-12-14-30-00.png")).toEqual(["2019-05-12T14:30:00", "second"]);
    expect(f("2019-05-12 14.30.00.jpg")).toEqual(["2019-05-12T14:30:00", "second"]);
  });

  test("a day without a time becomes noon", () => {
    expect(f("IMG-20190512-WA0001.jpg")).toEqual(["2019-05-12T12:00:00", "day"]);
    expect(f("scan 2001-02-03.tif")).toEqual(["2001-02-03T12:00:00", "day"]);
  });

  test("no date, impossible dates and long numbers are not dates", () => {
    expect(f("IMG_1234.jpg")).toBeNull();
    expect(f("DSC01234.JPG")).toBeNull();
    expect(f("IMG_20190231_120000.jpg")).toBeNull(); // Feb 31
    expect(f("1201905120000000.jpg")).toBeNull(); // starts mid-number
    expect(f("photo_1989-05-12.jpg")).toBeNull(); // before 1990
  });
});

describe("parseFolderDate", () => {
  test("dated folder names: day, month, year", () => {
    expect(d("/lib/2019-05-12 Birthday")).toEqual(["2019-05-12T12:00:00", "day", "2019-05-12 Birthday"]);
    expect(d("/lib/2019_05 Trip")).toEqual(["2019-05-15T12:00:00", "month", "2019_05 Trip"]);
    expect(d("/t/Takeout/Google Photos/Photos from 2019")).toEqual(["2019-07-01T12:00:00", "year", "Photos from 2019"]);
    expect(d("/lib/2019")).toEqual(["2019-07-01T12:00:00", "year", "2019"]);
  });

  test("nested numeric folders: year/month/day and year/month", () => {
    expect(d("/lib/2019/05/12")).toEqual(["2019-05-12T12:00:00", "day", "2019/05/12"]);
    expect(d("/lib/2019/05")).toEqual(["2019-05-15T12:00:00", "month", "2019/05"]);
    expect(d("/lib/2019/05 May")).toEqual(["2019-05-15T12:00:00", "month", "2019/05 May"]);
  });

  test("the deepest dated folder wins", () => {
    expect(d("/lib/2018/2019-05-12 Trip/raw")).toEqual(["2019-05-12T12:00:00", "day", "2019-05-12 Trip"]);
  });

  test("no dated folder → null; numbers that are not dates are ignored", () => {
    expect(d("/home/jim/Pictures/Trip")).toBeNull();
    expect(d("/lib/12/05")).toBeNull(); // no year above
    expect(d("C:\\Users\\jim\\Pictures\\2017-12-25 Xmas")).toEqual(["2017-12-25T12:00:00", "day", "2017-12-25 Xmas"]);
  });
});
