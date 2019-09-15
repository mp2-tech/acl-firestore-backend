declare module 'acl/test/backendtests' {
  type Tests = {
    [k: string]: Function;
  };
  let tests: Tests;
  export default tests;
}
