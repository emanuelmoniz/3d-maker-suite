-- A plate's machine profile; null (every plate so far) = the 3MF's on its printer, else the printer's.
ALTER TABLE `project_slice_plates` ADD `machine_profile_id` text REFERENCES machine_profiles(id) ON DELETE set null;
