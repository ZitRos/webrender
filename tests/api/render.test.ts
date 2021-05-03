import { expect } from "chai";
import fetch from "node-fetch";
import { LOCAL_API_URL } from "../const";

const URL = `${LOCAL_API_URL}/render`;
const method = "POST";
const headers = {
  "Content-Type": "application/json",
};

describe("/render", () => {
  it("successfully gets cats from Google Image Search", async () => {
    const result = await fetch(URL, {
      method,
      headers,
      body: JSON.stringify({
        url: "https://www.google.com/search?q=cats&tbm=isch",
        js: `
          let firstCat;
          while (true) {
            if (firstCat = document.querySelector('div[jsaction] div[jsaction] img')) {
              return { cat: firstCat.src };
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        `,
      }),
    });
    const response = await result.json();

    expect(result.status).to.equal(200);
    expect(response.result).to.have.property("cat");
    expect(response.result.cat).length.to.be.greaterThan(30); // Just test that it's there
  });

  it("returns the exact JavaScript error when provided 'js' is not valid", async () => {
    const result = await fetch(URL, {
      method,
      headers,
      body: JSON.stringify({
        url: "https://www.google.com/",
        js: "thisIsSomethingWeird",
      }),
    });
    const response = await result.json();

    expect(result.status).to.equal(500, JSON.stringify(response));
    expect(response).to.have.property("error");
    expect(response.error).to.include("Evaluation failed");
    expect(response.error).to.include(
      "ReferenceError: thisIsSomethingWeird is not defined"
    );
  });
});
