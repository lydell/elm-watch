export default ({ code }) =>
  code.replace("The text!", (match) => match.toUpperCase());
