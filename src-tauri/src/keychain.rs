use std::path::{Path, PathBuf};

use crate::error::AppResult;
use crate::types::ProviderId;

pub trait SecretStore: Send + Sync {
    fn set_api_key(&self, provider: ProviderId, value: &str) -> AppResult<()>;
    fn get_api_key(&self, provider: ProviderId) -> AppResult<Option<String>>;
    fn delete_api_key(&self, provider: ProviderId) -> AppResult<()>;
    fn has_api_key(&self, provider: ProviderId) -> AppResult<bool>;
}

pub struct SystemKeychain {
    service: String,
}

impl SystemKeychain {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, provider: ProviderId) -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(&self.service, provider.as_str())
    }
}

impl SecretStore for SystemKeychain {
    fn set_api_key(&self, provider: ProviderId, value: &str) -> AppResult<()> {
        self.entry(provider)?.set_password(value)?;
        Ok(())
    }

    fn get_api_key(&self, provider: ProviderId) -> AppResult<Option<String>> {
        match self.entry(provider)?.get_password() {
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn delete_api_key(&self, provider: ProviderId) -> AppResult<()> {
        match self.entry(provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn has_api_key(&self, provider: ProviderId) -> AppResult<bool> {
        Ok(self
            .get_api_key(provider)?
            .is_some_and(|value| !value.trim().is_empty()))
    }
}

pub struct FileSecretStore {
    root: PathBuf,
}

impl FileSecretStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn path_for(&self, provider: ProviderId) -> PathBuf {
        self.root.join(format!("{}.key", provider.as_str()))
    }

    fn ensure_root(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.root)?;
        Ok(())
    }

    fn write_secret(path: &Path, value: &str) -> AppResult<()> {
        std::fs::write(path, value)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }
}

impl SecretStore for FileSecretStore {
    fn set_api_key(&self, provider: ProviderId, value: &str) -> AppResult<()> {
        self.ensure_root()?;
        let path = self.path_for(provider);
        Self::write_secret(&path, value.trim())?;
        Ok(())
    }

    fn get_api_key(&self, provider: ProviderId) -> AppResult<Option<String>> {
        match std::fs::read_to_string(self.path_for(provider)) {
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => Ok(Some(value.trim().to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn delete_api_key(&self, provider: ProviderId) -> AppResult<()> {
        match std::fs::remove_file(self.path_for(provider)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn has_api_key(&self, provider: ProviderId) -> AppResult<bool> {
        Ok(self.path_for(provider).exists())
    }
}

pub struct MigratingSecretStore<S = SystemKeychain>
where
    S: SecretStore,
{
    primary_store: S,
    file_store: FileSecretStore,
}

impl MigratingSecretStore<SystemKeychain> {
    pub fn new(root: impl Into<PathBuf>, keychain_service: impl Into<String>) -> Self {
        Self {
            primary_store: SystemKeychain::new(keychain_service),
            file_store: FileSecretStore::new(root),
        }
    }
}

impl<S> MigratingSecretStore<S>
where
    S: SecretStore,
{
    #[cfg(test)]
    pub fn with_primary_store(root: impl Into<PathBuf>, primary_store: S) -> Self {
        Self {
            primary_store,
            file_store: FileSecretStore::new(root),
        }
    }

    fn migrate_from_file_store(&self, provider: ProviderId) -> AppResult<Option<String>> {
        let Some(value) = self.file_store.get_api_key(provider)? else {
            return Ok(None);
        };

        self.primary_store.set_api_key(provider, &value)?;
        self.file_store.delete_api_key(provider)?;
        Ok(Some(value))
    }
}

impl<S> SecretStore for MigratingSecretStore<S>
where
    S: SecretStore,
{
    fn set_api_key(&self, provider: ProviderId, value: &str) -> AppResult<()> {
        self.primary_store.set_api_key(provider, value)?;
        let _ = self.file_store.delete_api_key(provider);
        Ok(())
    }

    fn get_api_key(&self, provider: ProviderId) -> AppResult<Option<String>> {
        if let Some(value) = self.primary_store.get_api_key(provider)? {
            return Ok(Some(value));
        }

        self.migrate_from_file_store(provider)
    }

    fn delete_api_key(&self, provider: ProviderId) -> AppResult<()> {
        self.primary_store.delete_api_key(provider)?;
        self.file_store.delete_api_key(provider)?;
        Ok(())
    }

    fn has_api_key(&self, provider: ProviderId) -> AppResult<bool> {
        if self.primary_store.has_api_key(provider)? {
            return Ok(true);
        }

        Ok(self.migrate_from_file_store(provider)?.is_some())
    }
}

#[cfg(test)]
pub mod testsupport {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use crate::error::AppResult;
    use crate::types::ProviderId;

    use super::SecretStore;

    #[allow(dead_code)]
    #[derive(Default)]
    pub struct MemorySecretStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for MemorySecretStore {
        fn set_api_key(&self, provider: ProviderId, value: &str) -> AppResult<()> {
            self.values
                .lock()
                .expect("secret store lock poisoned")
                .insert(provider.as_str().to_string(), value.to_string());
            Ok(())
        }

        fn get_api_key(&self, provider: ProviderId) -> AppResult<Option<String>> {
            Ok(self
                .values
                .lock()
                .expect("secret store lock poisoned")
                .get(provider.as_str())
                .cloned())
        }

        fn delete_api_key(&self, provider: ProviderId) -> AppResult<()> {
            self.values
                .lock()
                .expect("secret store lock poisoned")
                .remove(provider.as_str());
            Ok(())
        }

        fn has_api_key(&self, provider: ProviderId) -> AppResult<bool> {
            Ok(self
                .values
                .lock()
                .expect("secret store lock poisoned")
                .contains_key(provider.as_str()))
        }
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::types::ProviderId;

    use super::{
        testsupport::MemorySecretStore, FileSecretStore, MigratingSecretStore, SecretStore,
    };

    #[test]
    fn migrates_plaintext_secret_into_primary_store() {
        let dir = tempdir().expect("temp dir");
        let root = dir.path().join("secrets");
        let file_store = FileSecretStore::new(root.clone());
        file_store
            .set_api_key(ProviderId::Xai, "xai-test-key")
            .expect("write file secret");

        let store = MigratingSecretStore::with_primary_store(root, MemorySecretStore::default());

        assert!(store.has_api_key(ProviderId::Xai).expect("has api key"));
        assert_eq!(
            store
                .primary_store
                .get_api_key(ProviderId::Xai)
                .expect("read primary store")
                .as_deref(),
            Some("xai-test-key")
        );
        assert_eq!(
            file_store
                .get_api_key(ProviderId::Xai)
                .expect("file secret removed"),
            None
        );
    }

    #[test]
    fn set_api_key_writes_to_primary_store_and_removes_plaintext_copy() {
        let dir = tempdir().expect("temp dir");
        let root = dir.path().join("secrets");
        let file_store = FileSecretStore::new(root.clone());
        file_store
            .set_api_key(ProviderId::Xai, "old-key")
            .expect("seed file secret");

        let store = MigratingSecretStore::with_primary_store(root, MemorySecretStore::default());
        store
            .set_api_key(ProviderId::Xai, "new-key")
            .expect("set api key");

        assert_eq!(
            store
                .primary_store
                .get_api_key(ProviderId::Xai)
                .expect("read primary store")
                .as_deref(),
            Some("new-key")
        );
        assert_eq!(
            file_store
                .get_api_key(ProviderId::Xai)
                .expect("file secret removed"),
            None
        );
    }
}
