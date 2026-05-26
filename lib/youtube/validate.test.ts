import { describe, expect, it } from "vitest";

import { parseYouTubeUrl } from "./validate";

const VALID_ID = "dQw4w9WgXcQ"; // 11 chars

describe("parseYouTubeUrl — valid formats", () => {
  it("parses youtube.com/watch?v=<id>", () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${VALID_ID}`)).toEqual({
      videoId: VALID_ID,
    });
  });

  it("parses youtu.be/<id>", () => {
    expect(parseYouTubeUrl(`https://youtu.be/${VALID_ID}`)).toEqual({
      videoId: VALID_ID,
    });
  });

  it("parses youtube.com/shorts/<id>", () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/shorts/${VALID_ID}`)).toEqual({
      videoId: VALID_ID,
    });
  });

  it("parses youtube.com/embed/<id>", () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${VALID_ID}`)).toEqual({
      videoId: VALID_ID,
    });
  });

  it("parses m.youtube.com/watch?v=<id>", () => {
    expect(parseYouTubeUrl(`https://m.youtube.com/watch?v=${VALID_ID}`)).toEqual({
      videoId: VALID_ID,
    });
  });
});

describe("parseYouTubeUrl — id extraction with extra params", () => {
  it("ignores timestamp / playlist params and keeps the id", () => {
    expect(
      parseYouTubeUrl(
        `https://www.youtube.com/watch?v=${VALID_ID}&t=42s&list=PLxyz&si=abc`,
      ),
    ).toEqual({ videoId: VALID_ID });
  });

  it("ignores ?t= on youtu.be short links", () => {
    expect(parseYouTubeUrl(`https://youtu.be/${VALID_ID}?t=10`)).toEqual({
      videoId: VALID_ID,
    });
  });

  it("accepts http and bare youtube.com host", () => {
    expect(parseYouTubeUrl(`http://youtube.com/watch?v=${VALID_ID}`)).toEqual({
      videoId: VALID_ID,
    });
  });
});

describe("parseYouTubeUrl — invalid inputs", () => {
  it("rejects empty string", () => {
    expect(parseYouTubeUrl("")).toBeNull();
    expect(parseYouTubeUrl("   ")).toBeNull();
  });

  it("rejects a non-YouTube host", () => {
    expect(parseYouTubeUrl(`https://vimeo.com/watch?v=${VALID_ID}`)).toBeNull();
    expect(
      parseYouTubeUrl(`https://evil-youtube.com/watch?v=${VALID_ID}`),
    ).toBeNull();
  });

  it("rejects ids that are too short", () => {
    expect(parseYouTubeUrl("https://youtu.be/abc123")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
  });

  it("rejects ids that are too long", () => {
    expect(parseYouTubeUrl(`https://youtu.be/${VALID_ID}EXTRA`)).toBeNull();
  });

  it("rejects non-URL strings", () => {
    expect(parseYouTubeUrl("not a url at all")).toBeNull();
    expect(parseYouTubeUrl("watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("rejects null / non-string / wrong protocol", () => {
    expect(parseYouTubeUrl(null)).toBeNull();
    expect(parseYouTubeUrl(undefined)).toBeNull();
    expect(parseYouTubeUrl(12345)).toBeNull();
    expect(
      parseYouTubeUrl(`ftp://www.youtube.com/watch?v=${VALID_ID}`),
    ).toBeNull();
  });

  it("rejects youtube.com without a video id", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/watch")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/shorts/")).toBeNull();
  });
});
