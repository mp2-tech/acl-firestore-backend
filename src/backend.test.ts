import * as admin from 'firebase-admin';
import FirestoreBackend from './backend';
import backendTests from 'acl/test/backendtests';

describe('Firestore', () => {
  before(function() {
    admin.initializeApp();
    this.backend = new FirestoreBackend(admin.firestore(), 'acl');
  });

  Object.keys(backendTests).forEach(test => {
    backendTests[test]();
  });
});
