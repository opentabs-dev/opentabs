// Register a default Trusted Types policy so React 19's internal script
// preloading (Suspense) does not trigger "TrustedScript" violations in
// Chrome's Manifest V3 extension context.
if (window.trustedTypes && trustedTypes.createPolicy) {
  trustedTypes.createPolicy('default', {
    createHTML: function (s) { return s; },
    createScript: function (s) { return s; },
    createScriptURL: function (s) { return s; },
  });
}
