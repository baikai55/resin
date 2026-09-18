package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/Resinat/Resin/internal/config"
)

// residentialStateFileName is the fixed file name read from EnvConfig.StateDir.
// It is produced out-of-band by the residential detection pipeline and is never
// written by Resin itself.
const residentialStateFileName = "residential_state.json"

// ResidentialEntry describes the residential quality of one egress IP.
type ResidentialEntry struct {
	Residential *bool  `json:"residential"`
	Fraud       *int   `json:"fraud"`
	ISP         string `json:"isp"`
	CC          string `json:"cc"`
	Source      string `json:"source"`
	TS          string `json:"ts"`
}

// ResidentialStateResponse is the payload returned by GET /api/v1/residential.
type ResidentialStateResponse struct {
	UpdatedAt string                      `json:"updated_at"`
	Count     int                         `json:"count"`
	Items     map[string]ResidentialEntry `json:"items"`
}

// residentialStateFile is the on-disk schema. It tolerates both the canonical
// `{"updated_at":...,"items":{ip:entry}}` shape and a bare `{ip:entry}` map.
type residentialStateFile struct {
	UpdatedAt string                      `json:"updated_at"`
	Items     map[string]ResidentialEntry `json:"items"`
}

// residentialStateCache memoizes the parsed file keyed by mtime+size so repeated
// UI polls do not re-parse a file that has not changed.
type residentialStateCache struct {
	mu      sync.Mutex
	modTime time.Time
	size    int64
	loaded  bool
	state   ResidentialStateResponse
}

var residentialCache residentialStateCache

// HandleResidentialState returns a handler for GET /api/v1/residential.
//
// The endpoint is strictly read-only: it reads residential_state.json from the
// configured state directory and joins nothing. It never fails when the file is
// absent so the UI can render an empty state before detection has run.
func HandleResidentialState(envCfg *config.EnvConfig) http.HandlerFunc {
	stateDir := ""
	if envCfg != nil {
		stateDir = envCfg.StateDir
	}

	return func(w http.ResponseWriter, _ *http.Request) {
		WriteJSON(w, http.StatusOK, loadResidentialState(stateDir))
	}
}

func loadResidentialState(stateDir string) ResidentialStateResponse {
	empty := ResidentialStateResponse{Items: map[string]ResidentialEntry{}}
	if stateDir == "" {
		return empty
	}

	path := filepath.Join(stateDir, residentialStateFileName)

	info, err := os.Stat(path)
	if err != nil {
		return empty
	}

	residentialCache.mu.Lock()
	defer residentialCache.mu.Unlock()

	if residentialCache.loaded &&
		residentialCache.modTime.Equal(info.ModTime()) &&
		residentialCache.size == info.Size() {
		return residentialCache.state
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return empty
	}

	state := parseResidentialState(data)
	residentialCache.modTime = info.ModTime()
	residentialCache.size = info.Size()
	residentialCache.loaded = true
	residentialCache.state = state
	return state
}

func parseResidentialState(data []byte) ResidentialStateResponse {
	state := ResidentialStateResponse{Items: map[string]ResidentialEntry{}}

	var file residentialStateFile
	if err := json.Unmarshal(data, &file); err != nil {
		return state
	}

	if file.Items != nil {
		state.UpdatedAt = file.UpdatedAt
		for ip, entry := range file.Items {
			if ip == "" {
				continue
			}
			state.Items[ip] = entry
		}
		state.Count = len(state.Items)
		return state
	}

	var bare map[string]ResidentialEntry
	if err := json.Unmarshal(data, &bare); err != nil {
		return state
	}
	for ip, entry := range bare {
		if ip == "" {
			continue
		}
		state.Items[ip] = entry
	}
	state.Count = len(state.Items)
	return state
}