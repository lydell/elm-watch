export default function postprocess({ code, targetName }) {
  if (targetName === "postprocess-error") {
    // Throwing a string instead of an `Error` avoids a stack trace in the snapshot.
    throw "Postprocess failed";
  }
  return code;
}
