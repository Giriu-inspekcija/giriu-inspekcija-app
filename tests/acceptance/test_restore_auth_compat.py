import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "gi_restore_auth_compat.py"
spec = importlib.util.spec_from_file_location("compat", path)
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)
base = b'COPY "auth"."custom_oauth_providers" ("id", "client_auth_method", "client_assertion_audience") FROM stdin;\n'
end = b'\\.\n'
other = b'COPY public.gi_cases (id) FROM stdin;\nabc\n\\.\n'

class CompatTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(compat.adapt(base + end + other, {"id"}, True), other)

    def test_no_mismatch(self):
        raw = base + b'1\tfoo\tbar\n' + end
        self.assertEqual(compat.adapt(raw, {"id"} | compat.ALLOWED, True), raw)

    def test_nonempty(self):
        with self.assertRaises(ValueError):
            compat.adapt(base + b'1\tfoo\tbar\n' + end, {"id"}, True)

    def test_unknown_missing_column(self):
        with self.assertRaises(ValueError):
            compat.adapt(base + end, {"other"}, True)

    def test_missing_table(self):
        with self.assertRaises(ValueError):
            compat.adapt(base + end, set(), False)

    def test_nonempty_target(self):
        with self.assertRaises(ValueError):
            compat.adapt(base + end, {"id"}, False)

    def test_unterminated(self):
        with self.assertRaises(ValueError):
            compat.adapt(base, {"id"}, True)

    def test_duplicate(self):
        with self.assertRaises(ValueError):
            compat.adapt((base + end) * 2, {"id"}, True)

    def test_other_copy_unchanged(self):
        self.assertEqual(compat.adapt(other, set(), False), other)

if __name__ == "__main__":
    unittest.main()
