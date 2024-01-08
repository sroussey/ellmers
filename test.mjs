import { createReadStream, close } from "fs";
import { open, writeFile } from "fs/promises";

await writeFile("mlem", Buffer.alloc(2 ** 18));

const openAndReadFile = () =>
  new Promise(async (resolve, reject) => {
    const fd = await open("mlem", "r");
    if (typeof fd === "number")
      createReadStream("", { fd, autoClose: false, emitClose: false })
        .on("data", (chunk) => {})
        .on("end", () => {
          close(fd, (error) => void (error ? reject(error) : resolve()));
        })
        .on("error", () => console.error("error") && reject());
    else
      fd.createReadStream({ autoClose: false, emitClose: false })
        .on("data", (chunk) => {})
        .on("end", () => {
          fd.close().then(resolve).catch(reject);
        })
        .on("error", () => console.error("error") && reject());
  });

for (let i = 0; i < 60000; ++i) {
  i % 1000 == 0 && console.log("opened", i);
  await openAndReadFile();
  i % 1000 == 0 && console.log("closed");
}
