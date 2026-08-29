/// <reference types="mocha" />
import { expect } from "chai";
import { DOI_REGEX, classifyInput, normalizeDOI } from "../src/utils/doi";
import {
  clearPref,
  getMirrorPriorities,
  mergeMirrors,
  orderMirrors,
  safeParseMirrors,
  setMirrorPriority,
} from "../src/modules/prefs";

describe("utils/doi", () => {
  describe("normalizeDOI", () => {
    it("trims whitespace", () => {
      expect(normalizeDOI("  10.1234/abc  ")).to.equal("10.1234/abc");
    });

    it("strips doi.org and dx.doi.org prefixes", () => {
      expect(
        normalizeDOI("https://doi.org/10.1038/s41586-020-2649-2"),
      ).to.equal("10.1038/s41586-020-2649-2");
      expect(normalizeDOI("http://dx.doi.org/10.1/ab")).to.equal("10.1/ab");
    });

    it("leaves bare DOIs untouched", () => {
      expect(normalizeDOI("10.1/ab")).to.equal("10.1/ab");
    });
  });

  describe("classifyInput", () => {
    it("routes bare DOIs and DOI URLs to the DOI path", () => {
      expect(classifyInput("10.1038/s41586-020-2649-2")).to.equal("doi");
      expect(classifyInput("https://doi.org/10.1038/abc")).to.equal("doi");
    });

    it("routes 6-9 digit inputs to the PMID path", () => {
      expect(classifyInput("32641826")).to.equal("pmid");
    });

    it("routes everything else to the title path", () => {
      expect(classifyInput("12345")).to.equal("title");
      expect(classifyInput("1234567890")).to.equal("title");
      expect(classifyInput("A new fossil from the Jurassic")).to.equal("title");
    });
  });

  describe("DOI_REGEX", () => {
    const valid = [
      "10.1038/s41586-020-2649-2",
      "10.1/AB",
      "10.1234/abc.def(g)h:1/2",
      "10.123456789/UPPER_case",
    ];
    const invalid = [
      "9.1038/abc",
      "10.abc/def",
      "10.1234/",
      "10.12345678901/ab",
      "10.1038/ab c",
      "10.1038/ab;c",
    ];
    for (const doi of valid)
      it(`accepts ${doi}`, () => expect(DOI_REGEX.test(doi)).to.equal(true));
    for (const doi of invalid)
      it(`rejects ${doi}`, () => expect(DOI_REGEX.test(doi)).to.equal(false));
  });
});

describe("modules/prefs", () => {
  describe("mergeMirrors", () => {
    it("dedupes by trimmed URL with defaults first", () => {
      const merged = mergeMirrors(
        ["https://a.org", "https://b.org/"],
        ["a.org", "  https://a.org  ", "https://c.org"],
      );
      expect(merged).to.deep.equal([
        "https://a.org",
        "https://b.org/",
        "https://c.org",
      ]);
    });

    it("drops empty entries", () => {
      expect(mergeMirrors(["https://a.org", ""], ["", "  "])).to.deep.equal([
        "https://a.org",
      ]);
    });
  });

  describe("safeParseMirrors", () => {
    it("returns null for unset, invalid JSON, and non-arrays", () => {
      expect(safeParseMirrors(undefined)).to.equal(null);
      expect(safeParseMirrors("not json")).to.equal(null);
      expect(safeParseMirrors('"a string"')).to.equal(null);
      expect(safeParseMirrors('{"a":1}')).to.equal(null);
    });

    it("returns parsed arrays", () => {
      expect(safeParseMirrors('["https://a.org"]')).to.deep.equal([
        "https://a.org",
      ]);
    });
  });

  describe("orderMirrors", () => {
    it("orders prioritized mirrors first (asc), then the rest in list order", () => {
      const { order, orderIndexOf } = orderMirrors(["a", "b", "c"], { c: 0 });
      expect(order).to.deep.equal(["c", "a", "b"]);
      expect(orderIndexOf).to.deep.equal([2, 0, 1]);
    });

    it("keeps list order for equal priority", () => {
      const { order, orderIndexOf } = orderMirrors(["a", "b"], {});
      expect(order).to.deep.equal(["a", "b"]);
      expect(orderIndexOf).to.deep.equal([0, 1]);
    });
  });

  describe("setMirrorPriority renumbering", () => {
    const urls = [
      "https://example.org/m1",
      "https://example.org/m2",
      "https://example.org/m3",
    ];

    beforeEach(() => {
      clearPref("mirrorPriority");
    });
    after(() => {
      clearPref("mirrorPriority");
    });

    it("shifts higher ranks down when a priority is removed", () => {
      setMirrorPriority(urls[0], 0);
      setMirrorPriority(urls[1], 1);
      setMirrorPriority(urls[2], 2);
      setMirrorPriority(urls[0], null);
      const prios = getMirrorPriorities();
      expect(prios[urls[1]]).to.equal(0);
      expect(prios[urls[2]]).to.equal(1);
      expect(prios[urls[0]]).to.equal(undefined);
    });
  });
});
