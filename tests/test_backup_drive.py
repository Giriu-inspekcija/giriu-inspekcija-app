import hashlib
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import Mock
p=pathlib.Path(__file__).resolve().parents[1]/"scripts"/"gi_backup_drive.py"
spec=importlib.util.spec_from_file_location("mirror",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MirrorTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=pathlib.Path(self.tmp.name)/"gi-supabase-20261127T032526Z.tar.gz.age"
        self.path.write_bytes(b"age-encryption.org/v1\nsynthetic")
        self.meta={"id":"fixture","name":self.path.name,"parents":[m.FOLDER],
                   "driveId":m.DRIVE,"trashed":False,"size":str(self.path.stat().st_size),
                   "sha256Checksum":hashlib.sha256(self.path.read_bytes()).hexdigest()}
        self.folder={"id":m.FOLDER,"driveId":m.DRIVE,"trashed":False,
                     "mimeType":"application/vnd.google-apps.folder",
                     "capabilities":{"canAddChildren":True}}
    def response(self,data=None,headers=None,status=200):
        r=Mock(status_code=status,headers=headers or {})
        r.json.return_value=data
        return r
    def test_archive(self):
        self.assertEqual(m.local_archive(self.path.parent),self.path)
        self.path.write_bytes(b"plaintext")
        with self.assertRaises(ValueError): m.local_archive(self.path.parent)
    def test_existing_immutable(self):
        s=Mock()
        s.request.side_effect=[self.response(self.folder),self.response({"files":[self.meta]})]
        self.assertEqual(m.mirror(s,self.path),"fixture")
        self.assertEqual(s.request.call_count,2)
    def test_wrong_hash_or_location(self):
        for change in ({"sha256Checksum":"wrong"},{"driveId":"wrong"},{"parents":["other"]}):
            s=Mock()
            s.request.side_effect=[self.response(self.folder),self.response({"files":[dict(self.meta,**change)]})]
            with self.assertRaises(ValueError): m.mirror(s,self.path)
            self.assertEqual(s.request.call_count,2)
    def test_duplicates(self):
        s=Mock()
        s.request.side_effect=[self.response(self.folder),self.response({"files":[self.meta,self.meta]})]
        with self.assertRaises(ValueError): m.mirror(s,self.path)
    def test_create_and_verify(self):
        s=Mock()
        s.request.side_effect=[self.response(self.folder),self.response({"files":[]}),
            self.response(headers={"Location":"https://www.googleapis.com/upload/drive/v3/files?upload_id=fake"}),
            self.response({"id":"fixture"}),self.response(self.meta)]
        self.assertEqual(m.mirror(s,self.path),"fixture")
        self.assertEqual([c.args[0] for c in s.request.call_args_list],["GET","GET","POST","PUT","GET"])
    def test_reject_external_endpoint(self):
        s=Mock()
        s.request.side_effect=[self.response(self.folder),self.response({"files":[]}),
            self.response(headers={"Location":"https://other.invalid/upload/drive/secret"})]
        with self.assertRaises(ValueError): m.mirror(s,self.path)
        self.assertEqual(s.request.call_count,3)

if __name__=="__main__": unittest.main()
