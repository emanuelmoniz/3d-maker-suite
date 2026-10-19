-- Results sliced before 2b42671 missed purges and inherited preset settings: slice again.
UPDATE `project_slice_plates` SET `sliced_at` = NULL, `sliced_print_profile_id` = NULL, `print_time_seconds` = NULL, `weight_grams` = NULL, `sliced_filaments` = NULL, `slice_error` = NULL;
