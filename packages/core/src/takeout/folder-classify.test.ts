import { describe, expect, test } from "bun:test";
import { classifyTakeoutFolder, isGooglePhotosDirName, yearOfFolder } from "./folder-classify";

describe("classifyTakeoutFolder", () => {
  test.each([
    ["Photos from 2019", "year", 2019],
    ["Photos from 2008", "year", 2008],
    ["Fotos aus 2021", "year", 2021],
    ["Photos de 2017", "year", 2017],
    ["Foto's uit 2015", "year", 2015],
  ])("%p is a year folder (%s %d)", (name, kind, year) => {
    expect(classifyTakeoutFolder(name)).toEqual({ kind: kind as "year", year, albumTitle: null });
  });

  test.each(["Trash", "Bin", "Archive", "Locked Folder", "Papierkorb", "archive"])("%p is special", (name) => {
    expect(classifyTakeoutFolder(name).kind).toBe("special");
  });

  test("anything else is an album, titled by its folder name", () => {
    expect(classifyTakeoutFolder("Trip to Lisbon 2019")).toEqual({
      kind: "album",
      year: null,
      albumTitle: "Trip to Lisbon 2019",
    });
    expect(classifyTakeoutFolder("Untitled(3)").kind).toBe("album");
  });

  test("an album title ending in a year is not mistaken for a year folder", () => {
    expect(yearOfFolder("Trip to Lisbon 2019")).toBeNull();
    expect(yearOfFolder("Summer 2020")).toBeNull();
  });
});

describe("isGooglePhotosDirName", () => {
  test("recognises the export directory and NFC/NFD spellings", () => {
    expect(isGooglePhotosDirName("Google Photos")).toBe(true);
    expect(isGooglePhotosDirName("Google Fotos")).toBe(true);
    expect(isGooglePhotosDirName("Zdjęcia Google".normalize("NFD"))).toBe(true);
    expect(isGooglePhotosDirName("Photos")).toBe(false);
  });
});
