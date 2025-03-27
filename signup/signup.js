document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signup-form');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const emailInput = document.getElementById('email');
    const fullnameInput = document.getElementById('fullname');
    const termsCheckbox = document.getElementById('terms');

    // Password validation function
    function validatePassword() {
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Password requirements
        const minLength = 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        let isValid = true;
        let errorMessage = [];

        if (password.length < minLength) {
            errorMessage.push('Password must be at least 8 characters long');
            isValid = false;
        }
        if (!hasUpperCase) {
            errorMessage.push('Include at least one uppercase letter');
            isValid = false;
        }
        if (!hasLowerCase) {
            errorMessage.push('Include at least one lowercase letter');
            isValid = false;
        }
        if (!hasNumbers) {
            errorMessage.push('Include at least one number');
            isValid = false;
        }
        if (!hasSpecialChar) {
            errorMessage.push('Include at least one special character');
            isValid = false;
        }
        if (password !== confirmPassword) {
            errorMessage.push('Passwords do not match');
            isValid = false;
        }

        return { isValid, errorMessage };
    }

    // Email validation function
    function validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Form submission handler
    signupForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // Reset previous error states
        const errorElements = document.querySelectorAll('.error-message');
        errorElements.forEach(element => element.remove());

        let isValid = true;

        // Validate full name
        if (fullnameInput.value.trim().length < 2) {
            displayError(fullnameInput, 'Please enter your full name');
            isValid = false;
        }

        // Validate email
        if (!validateEmail(emailInput.value)) {
            displayError(emailInput, 'Please enter a valid email address');
            isValid = false;
        }

        // Validate password
        const passwordValidation = validatePassword();
        if (!passwordValidation.isValid) {
            displayError(passwordInput, passwordValidation.errorMessage.join(', '));
            isValid = false;
        }

        // Validate terms acceptance
        if (!termsCheckbox.checked) {
            displayError(termsCheckbox, 'Please accept the Terms of Service and Privacy Policy');
            isValid = false;
        }

        if (isValid) {
            // Here you would typically send the data to your server
            console.log('Form is valid, submitting...');
            const formData = {
                fullname: fullnameInput.value,
                email: emailInput.value,
                password: passwordInput.value
            };
            console.log('Form data:', formData);
            
            // Simulate successful signup
            alert('Account created successfully! Please check your email for verification.');
            window.location.href = '../login/login.html';
        }
    });

    // Google Sign-in handler
    const googleSignInBtn = document.querySelector('.google-signin-btn');
    googleSignInBtn.addEventListener('click', function() {
        // Initialize Google Sign-In
        // Note: You'll need to replace YOUR_CLIENT_ID with your actual Google OAuth client ID
        const googleAuth = {
            client_id: 'YOUR_CLIENT_ID',
            scope: 'email profile',
        };
        
        // Redirect to Google Sign-In
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${googleAuth.client_id}` +
            `&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/google/callback')}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent(googleAuth.scope)}`;
    });

    // Helper function to display error messages
    function displayError(element, message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.color = '#ff3333';
        errorDiv.style.fontSize = '12px';
        errorDiv.style.marginTop = '5px';
        errorDiv.style.textAlign = 'left';
        errorDiv.textContent = message;
        element.parentNode.appendChild(errorDiv);
        element.style.borderColor = '#ff3333';
    }
}); 