acl-firestore-backend
=====================

Firestore backend for [NODE ACL](https://github.com/OptimalBits/node_acl)

```bash
$ yarn add acl-firestore-backend
```

### Example

```typescript
import Acl from 'acl';
import * as admin from 'firebase-admin';
import FirebaseBackend from 'acl-firestore-backend';

// initialize firebase application

const backend = new FirestoreBackend(admin.firestore(), 'acl');
const acl = new Acl(backend);
```
