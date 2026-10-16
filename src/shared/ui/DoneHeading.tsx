import CelebrationIcon from "@mui/icons-material/Celebration";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * The heading of a «thank you, it is done» screen: a green disc with a celebration glyph and the words beside it, level 2
 * (`CheckYourEmail`'s «Aproape gata, Ana!», the owner: the screen "should be more fun"; §800, the volunteers' «Mulțumim, Ana!» draws
 * the same one). The glyph is decoration; the words say it. Theme tokens only (`success.main`).
 */
export default function DoneHeading({ children }: { children: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: 48,
          height: 48,
          flexShrink: 0,
          borderRadius: "50%",
          bgcolor: "success.main",
          color: "success.contrastText",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CelebrationIcon />
      </Box>
      <Typography component="h2" variant="h2" sx={{ fontSize: { xs: "1.5rem", sm: "1.75rem" } }}>
        {children}
      </Typography>
    </Box>
  );
}
