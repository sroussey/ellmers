import { inner } from "simsimd";

function dot(arr1, arr2) {
  return arr1.reduce((acc, val, i) => acc + val * arr2[i], 0);
}

console.log(dot([1.0, 2.0, 3.0], [4.0, 5.0, 6.0])); // should output: 32
console.log(
  inner(new Float32Array([1.0, 2.0, 3.0]), new Float32Array([4.0, 5.0, 6.0]))
); // should output: 32
