CREATE DATABASE powersync_storage;

CREATE USER powersync_storage_user WITH PASSWORD 'powersync_storage_dev_password';

GRANT CONNECT ON DATABASE powersync_storage TO powersync_storage_user;
GRANT CREATE ON DATABASE powersync_storage TO powersync_storage_user;
