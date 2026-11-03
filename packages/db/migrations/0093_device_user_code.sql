ALTER TABLE `pairing_codes` ADD `device_id` text REFERENCES devices(id) ON DELETE cascade;
