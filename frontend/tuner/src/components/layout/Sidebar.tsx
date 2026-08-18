import {
  Box,
  Chip,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
} from '@mui/material'
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined'
import { NAV_GROUPS, NAV_ITEMS, type SectionId } from './navigation'

const WIDTH = 256

interface SidebarProps {
  active: SectionId
  onSelect: (id: SectionId) => void
  sourceCount: number
  vectorCount: number
  open: boolean
  onClose: () => void
}

export function Sidebar({
  active,
  onSelect,
  sourceCount,
  vectorCount,
  open,
  onClose,
}: SidebarProps) {
  const content = (
    <Box className="flex h-full flex-col" sx={{ width: WIDTH, bgcolor: 'background.paper' }}>
      <Box className="flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map((group) => (
          <List
            key={group}
            dense
            disablePadding
            sx={{ px: 1.5, pb: 1 }}
            subheader={
              <ListSubheader
                disableSticky
                sx={{
                  bgcolor: 'transparent',
                  fontSize: 11,
                  lineHeight: 2.4,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {group}
              </ListSubheader>
            }
          >
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
              <ListItemButton
                key={item.id}
                selected={item.id === active}
                onClick={() => {
                  onSelect(item.id)
                  onClose()
                }}
                sx={{
                  borderRadius: 2,
                  mb: 0.25,
                  '&.Mui-selected': {
                    bgcolor: 'action.selected',
                    color: 'primary.main',
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={item.label}
                  slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 500 } } }}
                />
                {item.id === 'embed' && sourceCount > 0 && (
                  <Chip label={sourceCount} size="small" sx={{ height: 20, fontSize: 11 }} />
                )}
              </ListItemButton>
            ))}
          </List>
        ))}
      </Box>

      <Divider />
      <Box className="px-4 py-3">
        <Typography
          variant="caption"
          sx={{ fontWeight: 600 }}
          className="flex items-center gap-1.5"
        >
          <StorageOutlinedIcon sx={{ fontSize: 15 }} />
          Vector store
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {vectorCount.toLocaleString()} vectors across {sourceCount}{' '}
          {sourceCount === 1 ? 'source' : 'sources'}
        </Typography>
      </Box>
    </Box>
  )

  return (
    <>
      <Box
        component="nav"
        sx={{ display: { xs: 'none', md: 'block' }, borderRight: 1, borderColor: 'divider' }}
      >
        {content}
      </Box>

      <Drawer
        open={open}
        onClose={onClose}
        sx={{ display: { md: 'none' } }}
        slotProps={{ paper: { sx: { width: WIDTH } } }}
      >
        {content}
      </Drawer>
    </>
  )
}
