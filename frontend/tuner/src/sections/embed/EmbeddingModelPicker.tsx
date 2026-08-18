import { useEffect, useState } from 'react'
import { Autocomplete, Box, CircularProgress, TextField, Typography } from '@mui/material'
import { FALLBACK_MODELS, fetchModels } from '../../lib/api'
import type { EmbeddingModel } from '../../lib/types'

interface PickerProps {
  value: string
  onChange: (modelId: string) => void
  disabled?: boolean
  error?: string
}

/**
 * Searchable picker over the Hub's embedding models.
 *
 * Falls back to a curated list when the catalogue route is unavailable, and
 * stays `freeSolo` so any model id can be typed in by hand.
 */
export function EmbeddingModelPicker({ value, onChange, disabled, error }: PickerProps) {
  const [search, setSearch] = useState('')
  const [models, setModels] = useState<EmbeddingModel[]>(FALLBACK_MODELS)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        const remote = await fetchModels(search)
        if (cancelled) return
        setModels(remote ?? filterFallback(search))
        setLoading(false)
      })()
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search])

  const selected = models.find((model) => model.id === value) ?? { id: value }

  return (
    <Autocomplete<EmbeddingModel, false, false, true>
      freeSolo
      disabled={disabled}
      options={models}
      loading={loading}
      value={selected}
      // The Hub already ranks and filters the results, so keep them as they come.
      filterOptions={(options) => options}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.id)}
      isOptionEqualToValue={(option, current) =>
        option.id === (typeof current === 'string' ? current : current.id)
      }
      onChange={(_, next) => onChange(typeof next === 'string' ? next : (next?.id ?? ''))}
      onInputChange={(_, next) => setSearch(next)}
      // A typed-out id counts as a choice; anything else the field resets on blur.
      onBlur={() => {
        const typed = search.trim()
        if (typed.includes('/') && typed !== value) onChange(typed)
      }}
      renderOption={({ key, ...props }, option) => (
        <Box component="li" key={key} {...props} className="flex items-center gap-2">
          <Typography
            variant="body2"
            sx={{ fontFamily: 'var(--font-mono)' }}
            className="flex-1 truncate"
          >
            {option.id}
          </Typography>
          {option.dimensions && (
            <Typography variant="caption" color="text.secondary">
              {option.dimensions}d
            </Typography>
          )}
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search the Hub, or paste a model id"
          error={Boolean(error)}
          helperText={error}
          sx={{ '& input': { fontFamily: 'var(--font-mono)', fontSize: 13 } }}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading && <CircularProgress size={16} />}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  )
}

function filterFallback(search: string): EmbeddingModel[] {
  const query = search.trim().toLowerCase()
  if (!query) return FALLBACK_MODELS
  return FALLBACK_MODELS.filter((model) => model.id.toLowerCase().includes(query))
}
