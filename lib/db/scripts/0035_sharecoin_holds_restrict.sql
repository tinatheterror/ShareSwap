-- A request that has a ShareCoin hold cannot be deleted: request_id on sharecoin_holds is ON DELETE RESTRICT. 0034 now creates
-- it that way; this converts a table created by the earlier CASCADE version. Idempotent.
ALTER TABLE sharecoin_holds DROP CONSTRAINT IF EXISTS sharecoin_holds_request_id_item_requests_id_fk;
ALTER TABLE sharecoin_holds ADD CONSTRAINT sharecoin_holds_request_id_item_requests_id_fk FOREIGN KEY (request_id) REFERENCES item_requests(id) ON DELETE RESTRICT;
