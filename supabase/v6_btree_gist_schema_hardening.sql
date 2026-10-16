-- btree_gist is relocatable; keep extension objects outside public exposed API schema.
alter extension btree_gist set schema extensions;