import assert from 'assert';
import * as admin from 'firebase-admin';

const BUCKET_FIELD = '@@bucket';

type Callback = (err?: Error | null, result?: any) => void;

type Result = string[];

interface UnionsResult {
  [k: string]: Result;
}

interface Data {
  [k: string]: boolean;
}

interface Operation {
  id: string;
  type: 'update' | 'delete';
  data?: Data;
}

const getId = (bucket: string, key: string) => [bucket, key].join('.');

const getBucketFromId = (id: string) => id.split('.').shift() || '';

const makeArray = (arr: string | string[]): string[] =>
  Array.isArray(arr) ? arr : [arr];

const snapToValues = (docSnap: admin.firestore.DocumentSnapshot) => {
  const data: Data = docSnap.data() || {};
  delete (data as any)[BUCKET_FIELD];
  return Object.keys(data);
};

export default class FirestoreBackend {
  constructor(
    private readonly store: admin.firestore.Firestore,
    private readonly collectionName: string
  ) {}

  private get collection() {
    return this.store.collection(this.collectionName);
  }

  private bucketIds(bucket: string, keys: string[]) {
    return keys.map(key => getId(bucket, key));
  }

  begin(): Operation[] {
    return [];
  }

  end(ops: Operation[], cb: Callback) {
    this.store
      .runTransaction(async tx => {
        const collection = this.collection;
        const docs: {
          [k: string]: {
            deleted: boolean;
            ref: admin.firestore.DocumentReference;
            snap?: admin.firestore.DocumentSnapshot;
            snapData?: Data;
          };
        } = {};
        const refs: admin.firestore.DocumentReference[] = [];

        // prepare document references
        for (const op of ops) {
          if (!docs[op.id]) {
            docs[op.id] = {
              deleted: false,
              ref: collection.doc(op.id),
            };
            refs.push(docs[op.id].ref);
          }
        }

        // get all documents from firestore
        const snaps = await this.store.getAll(...refs);
        for (const snap of snaps) {
          docs[snap.id].snap = snap;
          docs[snap.id].snapData = snap.exists ? snap.data() : {};
        }

        // apply operations
        for (const op of ops) {
          const doc = docs[op.id];
          switch (op.type) {
            case 'update':
              assert.ok(!doc.deleted);
              doc.snapData = Object.assign(
                {},
                doc.snapData || {},
                op.data || {}
              );
              break;
            case 'delete':
              doc.deleted = true;
              break;
            default:
              throw new Error('Unknown operation type: ' + op.type);
          }
        }

        // save changes
        for (const [id, doc] of Object.entries(docs)) {
          const data = doc.snapData || {};
          for (const [key, val] of Object.entries(data)) {
            if (!val) {
              delete data[key];
            }
          }
          if (doc.deleted || !Object.keys(data).length) {
            tx.delete(doc.ref);
          } else {
            (data as any)[BUCKET_FIELD] = getBucketFromId(id);
            tx.set(doc.ref, data);
          }
        }
      })
      .then(() => cb(), cb);
  }

  clean(cb: Callback) {
    if (process.env.NODE_ENV === 'test') {
      return cb();
    }
    throw new Error(
      '`clean` method will never be implemented in FirestoreBackend'
    );
  }

  get(bucket: string, key: string, cb: Callback) {
    (async () => {
      const id = getId(bucket, key);
      const docSnap = await this.collection.doc(id).get();
      if (!docSnap.exists) {
        cb(null, []);
        return;
      }
      cb(null, snapToValues(docSnap));
    })().catch(cb);
  }

  unions(buckets: string[], keys: string[], cb: Callback) {
    (async () => {
      const docRefs = buckets
        .map(bucket => this.bucketIds(bucket, keys))
        .reduce((all, bucketIds) => all.concat(bucketIds), [])
        .map(id => this.collection.doc(id));
      const docSnaps = await this.store.getAll(...docRefs);
      const result = buckets.reduce(
        (all, bucket) => {
          all[bucket] = [];
          return all;
        },
        {} as UnionsResult
      );
      docSnaps.forEach(docSnap => {
        const bucket = getBucketFromId(docSnap.id);
        result[bucket] = result[bucket].concat(snapToValues(docSnap));
      });
      buckets.forEach(bucket => {
        result[bucket] = Array.from(new Set(result[bucket] || []));
      });
      cb(null, result);
    })().catch(cb);
  }

  union(bucket: string, keys: string[], cb: Callback) {
    (async () => {
      const docRefs = this.bucketIds(bucket, keys).map(id =>
        this.collection.doc(id)
      );
      const docSnaps = await this.store.getAll(...docRefs);
      let result: string[] = [];
      docSnaps.forEach(docSnap => {
        if (docSnap.exists) {
          result = result.concat(Object.keys(docSnap.data() as object));
        }
      });
      result = Array.from(new Set(result));
      cb(null, result);
    })().catch(cb);
  }

  add(
    ops: Operation[],
    bucket: string,
    key: string,
    values: string[] | string
  ) {
    const id = getId(bucket, key);
    const data = makeArray(values).reduce(
      (data, val) => {
        data[val] = true;
        return data;
      },
      {} as Data
    );
    ops.push({ id, data, type: 'update' });
  }

  del(ops: Operation[], bucket: string, keys: string | string[]) {
    for (const key of makeArray(keys)) {
      ops.push({
        type: 'delete',
        id: getId(bucket, key),
      });
    }
  }

  remove(
    ops: Operation[],
    bucket: string,
    key: string,
    values: string | string[]
  ) {
    const id = getId(bucket, key);
    const data = makeArray(values).reduce(
      (data, val) => {
        data[val] = false;
        return data;
      },
      {} as Data
    );
    ops.push({ id, data, type: 'update' });
  }
}
