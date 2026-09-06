const SUPABASE_URL = "https://hnqrptrfxxtuxhawyvge.supabase.co";
    const SUPABASE_KEY = "sb_publishable_anROZEas9WH0SKrywRbG9Q_1zywb3ia";
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const approvalForm = document.querySelector("#approval-form");
    const approvalName = document.querySelector("#approval-name");
    const approvalStatus = document.querySelector("#approval-status");
    const gallery = document.querySelector("#gallery");
    const sectionNavLinks = Array.from(document.querySelectorAll('.nav-links a')).filter(link => {
      const url = new URL(link.href, window.location.href);
      return url.pathname === new URL("index.html", window.location.href).pathname && url.hash;
    });
    const imageViewer = document.querySelector("#image-viewer");
    const imageViewerImg = document.querySelector("#image-viewer-img");
    const imageViewerMeta = document.querySelector("#image-viewer-meta");
    const imageViewerClose = document.querySelector("#image-viewer-close");
    const imageViewerPrev = document.querySelector("#image-viewer-prev");
    const imageViewerNext = document.querySelector("#image-viewer-next");
    const heroGalleryCount = document.querySelector("#hero-gallery-count");
    const heroApprovalCount = document.querySelector("#hero-approval-count");
    const galleryControls = document.querySelector("#gallery-controls");
    const galleryMoreButton = document.querySelector("#gallery-more-button");
    const gallerySearch = document.querySelector("#gallery-search");
    const galleryEmpty = document.querySelector("#gallery-empty");
    let currentImageIndex = 0;
    let galleryImages = [];
    let galleryLoaded = false;
    let galleryLoading = false;
    let visibleGalleryCount = 8;
    let gallerySearchQuery = "";
    const GALLERY_BATCH_SIZE = 8;
    const APPROVAL_RATE_KEY = "marshymellowApprovalRate";
    const APPROVAL_SHORT_WINDOW_MS = 10 * 60 * 1000;
    const APPROVAL_SHORT_LIMIT = 2;
    const APPROVAL_LONG_WINDOW_MS = 60 * 60 * 1000;
    const APPROVAL_LONG_LIMIT = 10;
    const APPROVAL_PENALTY_MS = 2 * 60 * 60 * 1000;
    const APPROVAL_FINGERPRINT_KEY = "marshymellowApprovalFingerprint";

    function updateSectionNavigation() {
      const currentHash = window.location.hash;

      sectionNavLinks.forEach((link) => {
        const linkHash = new URL(link.href).hash;

        if (currentHash && linkHash === currentHash) {
          link.setAttribute("aria-current", "location");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }

    window.addEventListener("hashchange", updateSectionNavigation);
    updateSectionNavigation();

    function getGalleryImages() {
      return Array.from(gallery.querySelectorAll(".picture-card img"));
    }

    function renderImageViewerMetadata(image) {
      const record = image.galleryRecord;
      const title = document.createElement("h2");
      const details = document.createElement("dl");
      const addDetail = (label, value) => {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value || "Not available";
        row.append(term, description);
        details.append(row);
      };

      imageViewerMeta.replaceChildren();
      title.textContent = record?.title?.trim() || "";
      details.className = "image-viewer-details";

      if (title.textContent) {
        imageViewerMeta.append(title);
      }

      const captureDate = galleryCaptureDate(record || {});
      const worldName = record?.world_name?.trim() || "";
      const users = Array.isArray(record?.user_names)
        ? record.user_names.filter((name) => typeof name === "string" && name.trim())
        : [];
      const userCount = Number.isInteger(record?.user_count)
        ? Math.max(0, record.user_count)
        : users.length || null;

      if (!captureDate && !worldName && userCount === null) {
        const message = document.createElement("p");
        message.className = "image-viewer-empty";
        message.textContent = "No additional picture details are available.";
        imageViewerMeta.append(message);
        return;
      }

      addDetail("Date and time", formatImageDate(captureDate));
      addDetail("World", worldName);
      imageViewerMeta.append(details);

      const userSection = document.createElement("section");
      const userHeading = document.createElement("h3");
      const userNames = document.createElement("p");
      const userNote = document.createElement("p");
      userSection.className = "image-viewer-users";
      userHeading.textContent = userCount === null
        ? "Users in the instance"
        : `Users in the instance (${userCount})`;
      userNames.textContent = users.length
        ? users.join(", ")
        : userCount === null
          ? "Instance users were not included in this photo's metadata."
          : `${formatCount(userCount, "user")} recorded; display names unavailable.`;
      userNote.className = "image-viewer-note";
      userNote.textContent = "This list comes from VRCX metadata and may not always be accurate.";
      userSection.append(userHeading, userNames, userNote);
      imageViewerMeta.append(userSection);
    }

    function showImageAt(index) {
      const images = getGalleryImages();

      if (!images.length) {
        return;
      }

      currentImageIndex = (index + images.length) % images.length;
      const image = images[currentImageIndex];
      imageViewerImg.src = image.dataset.fullSrc || image.currentSrc || image.src;
      imageViewerImg.alt = image.alt;
      renderImageViewerMetadata(image);
    }

    let lastGalleryFocus = null;
    function openImageViewer(image) {
      const images = getGalleryImages();
      const index = images.indexOf(image);

      lastGalleryFocus = image;
      showImageAt(index >= 0 ? index : 0);
      imageViewer.hidden = false;
      imageViewerClose.focus();
    }

    function closeImageViewer() {
      imageViewer.hidden = true;
      imageViewerImg.removeAttribute("src");
      imageViewerMeta.replaceChildren();
      if (lastGalleryFocus?.isConnected) lastGalleryFocus.focus();
    }

    function showNextImage() {
      showImageAt(currentImageIndex + 1);
    }

    function showPreviousImage() {
      showImageAt(currentImageIndex - 1);
    }

    gallery.addEventListener("click", (event) => {
      const image = event.target.closest(".picture-card img");

      if (image) {
        openImageViewer(image);
      }
    });

    imageViewerClose.addEventListener("click", closeImageViewer);
    imageViewerPrev.addEventListener("click", showPreviousImage);
    imageViewerNext.addEventListener("click", showNextImage);

    imageViewer.addEventListener("click", (event) => {
      if (event.target === imageViewer) {
        closeImageViewer();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !imageViewer.hidden) {
        closeImageViewer();
      }

      if (event.key === "ArrowLeft" && !imageViewer.hidden) {
        showPreviousImage();
      }

      if (event.key === "ArrowRight" && !imageViewer.hidden) {
        showNextImage();
      }
    });

    function normalizeName(value) {
      return value.trim().replace(/\s+/g, " ");
    }

    function getNameError(name) {
      if (name.length < 2) {
        return "Name must be at least 2 characters.";
      }

      if (name.length > 32) {
        return "Name must be 32 characters or fewer.";
      }

      if (/https?:\/\/|www\.|\.com|\.gg|discord\.gg/i.test(name)) {
        return "Links are not allowed in names.";
      }

      if (/[\u0000-\u001f\u007f]/.test(name)) {
        return "Control characters are not allowed.";
      }

      if (/[<>()[\]{}|\\]/.test(name)) {
        return "That name uses symbols that are not allowed.";
      }

      if (/(.)\1{5,}/iu.test(name.replace(/\s/g, ""))) {
        return "Name has too many repeated characters.";
      }

      if (/admin|owner|moderator|support/i.test(name)) {
        return "Please do not use staff-style names.";
      }

      return "";
    }

    function readApprovalRateState() {
      try {
        const state = JSON.parse(localStorage.getItem(APPROVAL_RATE_KEY)) || {};
        return {
          attempts: Array.isArray(state.attempts) ? state.attempts : [],
          blockedUntil: Number(state.blockedUntil) || 0
        };
      } catch {
        return { attempts: [], blockedUntil: 0 };
      }
    }

    function saveApprovalRateState(state) {
      localStorage.setItem(APPROVAL_RATE_KEY, JSON.stringify(state));
    }

    function formatWaitTime(milliseconds) {
      const minutes = Math.ceil(milliseconds / 60000);

      if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
      }

      return `${minutes}m`;
    }

    function checkApprovalCooldown() {
      const now = Date.now();
      const state = readApprovalRateState();
      state.attempts = state.attempts.filter((time) => now - time < APPROVAL_LONG_WINDOW_MS);

      if (state.blockedUntil > now) {
        saveApprovalRateState(state);
        return `Too many TOS submissions. Try again in ${formatWaitTime(state.blockedUntil - now)}.`;
      }

      if (state.attempts.length >= APPROVAL_LONG_LIMIT) {
        state.blockedUntil = now + APPROVAL_PENALTY_MS;
        saveApprovalRateState(state);
        return "Too many TOS submissions in one hour. Cooldown increased to 2 hours.";
      }

      const shortAttempts = state.attempts.filter((time) => now - time < APPROVAL_SHORT_WINDOW_MS);

      if (shortAttempts.length >= APPROVAL_SHORT_LIMIT) {
        const oldestShortAttempt = Math.min(...shortAttempts);
        const waitTime = APPROVAL_SHORT_WINDOW_MS - (now - oldestShortAttempt);
        saveApprovalRateState(state);
        return `You can submit 2 TOS names every 10 minutes. Try again in ${formatWaitTime(waitTime)}.`;
      }

      saveApprovalRateState(state);
      return "";
    }

    function recordApprovalAttempt() {
      const now = Date.now();
      const state = readApprovalRateState();
      state.attempts = state.attempts
        .filter((time) => now - time < APPROVAL_LONG_WINDOW_MS)
        .concat(now);

      if (state.attempts.length >= APPROVAL_LONG_LIMIT) {
        state.blockedUntil = now + APPROVAL_PENALTY_MS;
      }

      saveApprovalRateState(state);
    }

    function getApprovalFingerprint() {
      let fingerprint = localStorage.getItem(APPROVAL_FINGERPRINT_KEY);

      if (!fingerprint) {
        fingerprint = crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(APPROVAL_FINGERPRINT_KEY, fingerprint);
      }

      return fingerprint;
    }

    function formatImageDate(value) {
      if (!value || Number.isNaN(new Date(value).getTime())) {
        return "";
      }

      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    }

    function galleryCaptureDate(image) {
      if (image.captured_at) {
        return image.captured_at;
      }

      const match = image.image_path?.match(/vrchat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.(\d{1,3}))?/i);

      if (match) {
        const [, year, month, day, hour, minute, second, milliseconds = "0"] = match;
        const date = new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second),
          Number(milliseconds.padEnd(3, "0"))
        );

        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      return image.created_at || null;
    }

    function formatCount(count, singular, plural = `${singular}s`) {
      if (!Number.isFinite(count)) {
        return plural;
      }

      return `${count} ${count === 1 ? singular : plural}`;
    }

    function normalizeGallerySearch(value) {
      return String(value || "").normalize("NFKC").toLocaleLowerCase().trim();
    }

    function imageMatchesTitle(image, query) {
      return normalizeGallerySearch(image.title).includes(query);
    }

    function renderCurrentGallery() {
      const filteredImages = gallerySearchQuery
        ? galleryImages.filter((image) => imageMatchesTitle(image, gallerySearchQuery))
        : galleryImages;
      renderUploadedImages(filteredImages, Boolean(gallerySearchQuery));
    }

    function renderUploadedImages(images, showAll = false) {
      gallery.querySelectorAll("[data-uploaded-image], .scrapbook-month").forEach((card) => card.remove());
      heroGalleryCount.textContent = formatCount(galleryImages.length, "picture");
      galleryEmpty.textContent = gallerySearchQuery
        ? "No pictures found with that title."
        : "No pictures are available yet.";
      galleryEmpty.hidden = images.length > 0;
      const displayedImages = showAll ? images : images.slice(0, visibleGalleryCount);

      let previousMonth = null;
      displayedImages.forEach((image) => {
        const rawDate = galleryCaptureDate(image);
        const date = rawDate ? new Date(rawDate) : null;
        const month = date && !Number.isNaN(date.getTime())
          ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)
          : "Undated memories";
        if (month !== previousMonth) {
          const heading = document.createElement("h3");
          heading.className = "scrapbook-month";
          heading.textContent = month;
          gallery.append(heading);
          previousMonth = month;
        }
        const article = document.createElement("article");
        const img = document.createElement("img");
        const caption = document.createElement("div");
        const title = document.createElement("strong");
        const capturedAt = document.createElement("time");
        const captureDate = galleryCaptureDate(image);
        const { data: fullImage } = db.storage.from("gallery").getPublicUrl(image.image_path);
        const { data: thumbnail } = db.storage.from("gallery").getPublicUrl(image.thumbnail_path || image.image_path);

        article.className = "picture-card";
        article.dataset.uploadedImage = "true";
        caption.className = "picture-caption";
        title.className = "picture-title";
        img.src = thumbnail.publicUrl;
        img.dataset.fullSrc = fullImage.publicUrl;
        img.dataset.triedFullImage = image.thumbnail_path ? "false" : "true";
        img.alt = image.title || "VRChat gallery picture";
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", "Enlarge " + img.alt);
        img.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openImageViewer(img); }
        });
        img.loading = "lazy";
        img.decoding = "async";
        img.fetchPriority = "low";
        img.galleryRecord = image;
        title.textContent = image.title || "A little Marshy memory";
        capturedAt.dateTime = captureDate || "";
        capturedAt.textContent = captureDate
          ? `Taken ${formatImageDate(captureDate)}`
          : "Capture time unavailable";
        img.onerror = () => {
          if (img.dataset.triedFullImage === "false") {
            img.dataset.triedFullImage = "true";
            img.src = fullImage.publicUrl;
            return;
          }

          title.textContent = image.title
            ? `${image.title} - image could not load`
            : "Image could not load";
        };

        if (title.textContent) {
          caption.append(title);
        }

        caption.append(capturedAt);

        article.append(img, caption);
        gallery.append(article);
      });

      const hasMoreImages = !showAll && images.length > visibleGalleryCount;
      galleryControls.hidden = !hasMoreImages;
      galleryMoreButton.textContent = "Show all pictures";
    }

    async function loadGalleryImages() {
      if (galleryLoading) {
        return;
      }

      galleryLoading = true;
      try {
        const { data, error } = await db.rpc("get_public_gallery_images");

        if (!error) {
          galleryImages = (data || []).sort((first, second) => {
            const firstTime = new Date(galleryCaptureDate(first) || 0).getTime();
            const secondTime = new Date(galleryCaptureDate(second) || 0).getTime();
            return secondTime - firstTime;
          });
          visibleGalleryCount = Math.min(visibleGalleryCount, Math.max(GALLERY_BATCH_SIZE, galleryImages.length));
          renderCurrentGallery();
          galleryLoaded = true;
        } else if (!galleryLoaded) {
          galleryEmpty.textContent = "The gallery is temporarily unavailable.";
          galleryEmpty.hidden = false;
        }
      } catch (error) {
        if (!galleryLoaded) {
          galleryEmpty.textContent = "The scrapbook couldn't load. Please refresh to try again.";
          galleryEmpty.hidden = false;
        }
      } finally {
        galleryLoading = false;
      }
    }

    async function loadGalleryCount() {
      const { data, error } = await db.rpc("get_public_gallery_image_count");
      const count = Number(data);

      if (!error && Number.isFinite(count)) {
        heroGalleryCount.textContent = formatCount(count, "picture");
      }
    }

    galleryMoreButton.addEventListener("click", () => {
      visibleGalleryCount = galleryImages.length;
      renderCurrentGallery();
    });

    gallerySearch.addEventListener("input", () => {
      gallerySearchQuery = normalizeGallerySearch(gallerySearch.value);
      renderCurrentGallery();
    });

    async function loadApprovalCount() {
      const { count, error } = await db
        .from("approvals")
        .select("id", { count: "exact", head: true });

      if (!error) {
        heroApprovalCount.textContent = formatCount(count, "approval");
      }
    }

    db
      .channel("approval-count-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approvals" },
        loadApprovalCount
      )
      .subscribe();

    const gallerySection = document.querySelector("#pictures");
    const galleryObserver = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            loadGalleryImages();
            galleryObserver.disconnect();
          }
        }, { rootMargin: "700px 0px" })
      : null;

    if (galleryObserver) {
      galleryObserver.observe(gallerySection);
    } else {
      loadGalleryImages();
    }

    loadGalleryCount();
    loadApprovalCount();
    setInterval(() => {
      if (document.hidden) {
        return;
      }

      loadGalleryCount();
      loadApprovalCount();

      if (galleryLoaded) {
        loadGalleryImages();
      }
    }, 5 * 60 * 1000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadGalleryCount();
        loadApprovalCount();

        if (galleryLoaded) {
          loadGalleryImages();
        }
      }
    });

    approvalForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const name = normalizeName(approvalName.value);
      const submitButton = approvalForm.querySelector("button");
      const nameError = getNameError(name);

      if (nameError) {
        approvalStatus.textContent = nameError;
        return;
      }

      const cooldownError = checkApprovalCooldown();

      if (cooldownError) {
        approvalStatus.textContent = cooldownError;
        return;
      }

      recordApprovalAttempt();
      submitButton.disabled = true;
      approvalStatus.textContent = "Saving approval...";

      const { error } = await db
        .rpc("submit_tos_approval", {
          approval_name: name,
          visitor_fingerprint: getApprovalFingerprint()
        });

      submitButton.disabled = false;

      if (error && error.code === "23505") {
        approvalStatus.textContent = `${name} is already on the approved list.`;
        approvalName.value = "";
        window.location.href = "approved.html";
        return;
      }

      if (error) {
        approvalStatus.textContent = error.message.includes("too_many_approvals")
          ? "Too many TOS submissions in one hour. Try again in 2 hours."
          : "Could not save approval. Check the name and try again.";
        return;
      }

      approvalStatus.textContent = `${name} approved the TOS.`;
      approvalName.value = "";
      window.location.href = "approved.html";
    });

    document.querySelectorAll("[data-gallery-view]").forEach(button => {
      button.addEventListener("click", () => {
        gallery.dataset.view = button.dataset.galleryView;
        document.querySelectorAll("[data-gallery-view]").forEach(option => {
          option.setAttribute("aria-pressed", String(option === button));
        });
      });
    });
